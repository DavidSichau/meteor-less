const { path } = Plugin;
// eslint-disable-next-line no-undef
const less = Npm.require('less');
// eslint-disable-next-line no-undef
const Future = Npm.require('fibers/future');
const hasOwn = Object.prototype.hasOwnProperty;

class MeteorImportLessFileManager extends less.AbstractFileManager {
  constructor(dependencyManager) {
    super();
    this.dependencyManager = dependencyManager;
  }

  // We want to be the only active FileManager, so claim to support everything.
  // eslint-disable-next-line class-methods-use-this
  supports(filename) {
    // We shouldn't process files that start with `//` or a protocol because
    // those are not relative to the app at all they are probably native
    // CSS imports
    return !filename.match(/^(https?:)?\/\//);
  }

  loadFile(filename, currentDirectory) {
    const packageMatch = currentDirectory.match(/^(\{[^}]*\})/);
    if (!packageMatch) {
      // shouldn't happen.  all filenames less ever sees should involve this {}
      // thing!
      return new Promise((r, reject) => {
        reject(new Error(`file without Meteor context? ${currentDirectory}`));
      });
    }
    const currentPackagePrefix = packageMatch[1];

    let resolvedFilename;
    if (filename[0] === '/') {
      // Map `/foo/bar.less` onto `{thispackage}/foo/bar.less`
      resolvedFilename = currentPackagePrefix + filename;
    } else if (filename[0] === '{') {
      resolvedFilename = filename;
    } else {
      resolvedFilename = path.join(currentDirectory, filename);
    }
    // Map e.g. @import ./themes/index to ./themes/index.less
    if (
      !this.dependencyManager.has(resolvedFilename) &&
      this.dependencyManager.has(`${resolvedFilename}.less`)
    ) {
      resolvedFilename = `${resolvedFilename}.less`;
    }

    if (!this.dependencyManager.has(resolvedFilename)) {
      return new Promise((r, reject) => {
        reject(new Error(`Unknown import: ${filename}`));
      });
    }
    return new Promise((resolve) => {
      resolve({
        contents: this.dependencyManager
          .get(resolvedFilename)
          .getContentsAsBuffer()
          .toString('utf8'),
        filename: resolvedFilename,
      });
    });
  }
}

function MeteorImportLessPlugin(dependencyManager) {
  this.minVersion = [3, 6, 0];

  this.install = (l, pluginManager) => {
    pluginManager.addFileManager(new MeteorImportLessFileManager(dependencyManager));
  };
}

function decodeFilePath(filePath) {
  const match = filePath.match(/^{(.*)}\/(.*)$/);
  if (!match) {
    throw new Error(`Failed to decode Less path: ${filePath}`);
  }

  if (match[1] === '') {
    // app
    return match[2];
  }

  return `packages/${match[1]}/${match[2]}`;
}

// CompileResult is {css, sourceMap}.
// eslint-disable-next-line no-undef
class LessCompiler extends MultiFileCachingCompiler {
  constructor() {
    super({
      compilerName: 'less',
      defaultCacheSize: 1024 * 1024 * 10,
    });
  }

  getCacheKey = (inputFile) => [inputFile.getArch(), inputFile.getSourceHash()];

  compileResultSize(compileResult) {
    return compileResult.css.length + this.sourceMapSize(compileResult.sourceMap);
  }

  // The heuristic is that a file is an import (ie, is not itself
  // processed as a root) if it matches *.import.less
  // This can be overridden in either direction via an explicit `isImport`
  // file option in api.addFiles.
  isRoot = (inputFile) => {
    const fileOptions = inputFile.getFileOptions();

    if (hasOwn.call(fileOptions, 'isImport')) {
      return !fileOptions.isImport;
    }

    if (fileOptions.lazy) {
      return false;
    }

    const pathInPackage = inputFile.getPathInPackage();
    return !(/\.import\.less$/.test(pathInPackage) || /\.lessimport$/.test(pathInPackage));
  };

  compileOneFile(inputFile, dependencyManager) {
    const importPlugin = new MeteorImportLessPlugin(dependencyManager);

    const f = new Future();
    let output;
    try {
      less.render(
        inputFile.getContentsAsBuffer().toString('utf8'),
        {
          filename: this.getAbsoluteImportPath(inputFile),
          plugins: [importPlugin],
          javascriptEnabled: true,
          // Generate a source map, and include the source files in the
          // sourcesContent field.  (Note that source files which don't themselves
          // produce text (eg, are entirely variable definitions) won't end up in
          // the source map!)
          sourceMap: { outputSourceFiles: true },
        },
        f.resolver(),
      );
      output = f.wait();
    } catch (e) {
      inputFile.error({
        message: e.message,
        sourcePath: decodeFilePath(e.filename),
        line: e.line,
        column: e.column,
      });
      return null;
    }

    if (output.map) {
      const map = JSON.parse(output.map);
      map.sources = map.sources.map(decodeFilePath);
      output.map = map;
    }

    const compileResult = { css: output.css, sourceMap: output.map };
    const referencedImportPaths = [];
    output.imports.forEach((outputPath) => {
      // Some files that show up in output.imports are not actually files; for
      // example @import url("...");
      if (dependencyManager.has(outputPath)) {
        referencedImportPaths.push(outputPath);
      }
    });

    return { compileResult, referencedImportPaths };
  }

  addCompileResult = (inputFile, compileResult) => {
    inputFile.addStylesheet({
      data: compileResult.css,
      path: `${inputFile.getPathInPackage()}.css`,
      sourceMap: compileResult.sourceMap,
    });
  };
}

Plugin.registerCompiler(
  {
    extensions: ['less', 'lessimport'],
    archMatching: 'web',
  },
  () => new LessCompiler(),
);
