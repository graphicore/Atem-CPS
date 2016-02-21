define([
    'Atem-CPS/errors'
  , 'gonzales/gonzales'
  , './curry'
  , './engine'
  , './propertyFactories'
  , './atDictionaryFactories'
  , './atImportFactories'
], function (
    errors
  , gonzales
  , curry
  , parserEngine
  , propertyFactoriesModule
  , atDictionaryFactories
  , atImportFactories
) {
    "use strict";
    var CPSError = errors.CPS
      , CPSParserError = errors.CPSParser
      , propertyFactories = propertyFactoriesModule.factories
      , module = {
          parser: gonzales.srcToCSSP
      }
      ;

    var factorySwitches = [
            atDictionaryFactories.atDictionaryParsingSwitch,
            atImportFactories.atImportParsingSwitch
        ]
      , rulesFromAST = curry(parserEngine, propertyFactories, factorySwitches)
      ;
    /**
     * Create a PropertyCollection from a CSS string
     */
    function rulesFromString(css, sourceName, ruleController) {
        var ast;
        try {
            ast = module.parser(css);
        }
        catch (error) {
            // gonzales throws a pure JavaScript Error, but we want more
            // certainty in the rest of our application
            throw new CPSParserError("("+sourceName+") "+error.message, error.stack);
        }

        // An empty string as input to gonzales creates an undefined ast.
        // FIXME: this should be the output of gonzales for an empty string!
        if(ast === undefined) ast = ['stylesheet'];

        return module.fromAST(ast, sourceName, ruleController);
    }

    module.fromString = rulesFromString;
    module.fromAST = rulesFromAST;

    return module;
});
