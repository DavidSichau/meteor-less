Package.describe({
  name: 'davidsichau:less',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: 'Current less compiler for meteor',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md',
});

Package.registerBuildPlugin({
  name: 'compileLessBatch',
  use: ['caching-compiler@1.2.1', 'ecmascript@0.14.2'],
  sources: ['plugin/compile-less.js'],
  npmDependencies: {
    less: '3.11.1',
  },
});

Package.onUse(function (api) {
  api.use('isobuild:compiler-plugin@1.0.0');
});
