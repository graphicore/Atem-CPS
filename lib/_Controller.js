define([
    'Atem-CPS/errors'
  , 'Atem-CPS/CPS/elements/Rule'
  , 'Atem-CPS/CPS/StyleDict'
  , 'Atem-CPS/CPS/parsing/parseRules'
], function(
    errors
  , Rule
  , StyleDict
  , parseRules
) {
    "use strict";
    var CPSError = errors.CPS
      , KeyError = errors.Key
      , NotImplementedError = errors.NotImplemented
      ;

    function Controller(ruleController, rootNodeFactory, selectorEngine) {
        this._ruleController = ruleController;

        this._selectorEngine = selectorEngine;
        this._root = rootNodeFactory(this);

        // {element.nodeID: styleDict}
        this._styleDicts = Object.create(null);

        // {ruleKey:[parameterCollection, subscriptionID, [element.nodeIDs, ...]]}
        this._rules = Object.create(null);
    }

    var _p = Controller.prototype;

    /**
     * StyleDict constructor, can be changed by inheritance or
     * monkey patched on instances
     */
    _p.StyleDict = StyleDict;

    _p.updateChangedRule = function(async, ruleKey) {
        return this._ruleController.reloadRule(async, ruleKey);
    };

    /**
     * Return a string that will be used with RuleController.getRule(false, cpsName);
     *
     * Applications can decide themselves which CPS files apply to which
     * part of thee OMA-tree.
     */
    _p.getCPSName = function(element) {
        throw new NotImplementedError('getCPSName must be implemented by a subclass.');
    };

    /**
     * Used from within _getComputedStyle and StyleDict, don't use it
     * anywhere else! This is not cached here and pretty expensive.
     * If needed we will add a rules property getter to StyleDict.
     */
    _p.getRulesForElement = function(element) {
        var ruleKey = this.getCPSName(element)
          , parameterCollection
          , subscriptionID
          , rules, allRules
          ;
        if(!this._rules[ruleKey]) {
            // subscribe only once, this saves calling us a lot of handlers
            // for each styledict
            // we are currently not unsubscribing, because we don't
            // unload parameterCollections ever.
            // TODO: unload parameterCollections if they are not used anymore.
            //       Probably add a reference counter for that. Maybe this
            //       is better done in _ruleController. The unsubscription
            //       here could happen on('destroy');
            parameterCollection = this._ruleController.getRule(false, ruleKey);
            subscriptionID = parameterCollection.on('structural-change', [this, '_updateRule'], ruleKey);
            this._rules[ruleKey] = [parameterCollection, subscriptionID, []];
        }
        else
            parameterCollection = this._rules[ruleKey][0];
        rules = this._selectorEngine.getMatchingRules(parameterCollection, element);
        this._rules[ruleKey][2].push(element.nodeID);
        return rules;
    };

    _p._getComputedStyle = function(element) {
        // rules will be pulled lazily from styleDict, when needed
        var rules = null // rules = this.getRulesForElement(element)
          , styleDict = new this.StyleDict(this, element, rules)
          ;
        this._styleDicts[element.nodeID] = styleDict;
        return styleDict;
    };

    /**
     * returns a single StyleDict to read the final cascaded, computed
     * style for that element.
     */
    _p.getComputedStyle = function(element) {
        if(element.root !== this._root)
            throw new CPSError('getComputedStyle with an element that is not '
                + 'part of the multivers is not supported' + element);
        // this._styleDicts cache set in _getComputedStyle
        return this._styleDicts[element.nodeID] || this._getComputedStyle(element);
    };

    /**
     * Update each styleDict that uses the rule called `ruleKey`
     */
    _p._updateRule = function(ruleKey) {
        var ids = this._rules[ruleKey][2]
          , styleDict
          , i, l
          ;
        for(i=0,l=ids.length;i<l;i++) {
            styleDict = this._styleDicts[ ids[i] ];
            styleDict.invalidateRules();
        }
    };

    _p._checkScope = function(_scope) {
        var i, scope;
        if(!_scope)
            return [this._root];
        scope = _scope instanceof Array
            ? _scope
            : [_scope]
            ;
        for(i=0;i<scope.length;i++)
            if(scope[i].root !== this._root)
                throw new CPSError('Query with a scope that is not '
                    +'part of the multivers is not supported '
                    + scope[i].particulars);
        return scope;
    };

    _p.queryAll = function(selector, scope) {
        var result = this._selectorEngine.queryAll(this._checkScope(scope), selector);
        // monkey patching the returned array.
        // it may become useful to invent an analogue to Web API NodeList
        result.query = this._selectorEngine.queryAll.bind(this._selectorEngine, result);
        return result;
    };

    _p.query = function(selector, scope) {
        return this._selectorEngine.query(this._checkScope(scope), selector);
    };

    return Controller;
});
