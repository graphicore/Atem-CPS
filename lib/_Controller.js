define([
    'Atem-CPS/errors'
  , 'Atem-CPS/CPS/elements/Rule'
  , 'Atem-CPS/CPS/StyleDict'
], function(
    errors
  , Rule
  , StyleDict
) {
    "use strict";

    var CPSError = errors.CPS
      , NotImplementedError = errors.NotImplemented
      , assert = errors.assert
      ;

    function Controller(ruleController, rootNodeFactory, selectorEngine) {
        this._ruleController = ruleController;

        this._selectorEngine = selectorEngine;
        this._root = rootNodeFactory(this);

        // {element: [styleDict, elementSubscription]}
        this._elementsData = new Map();


        // {ruleKey:[propertyCollection, subscriptionID, [element.nodeID, ...]]}
        this._rules = Object.create(null);
        this._lastElementRules = new WeakMap();
    }

    var _p = Controller.prototype;

    /**
     * StyleDict constructor, can be changed by inheritance or
     * monkey patched on instances
     */
    _p.StyleDict = StyleDict;

    Object.defineProperty(_p, 'rootNode', {
        get: function(){ return this._root;}
    });

    _p.updateChangedRule = function(async, ruleKey) {
        return this._ruleController.reloadRule(async, ruleKey);
    };

    /**
     * Return a string that will be used with RuleController.getRule(false, cpsName);
     *
     * Applications can decide themselves which CPS files apply to which
     * part of thee OMA-tree.
     *
     * May return null, if the element has no associated cps file.
     */
    _p.getCPSName = function(element) {
        // jshint unused:false
        throw new NotImplementedError('getCPSName must be implemented by a subclass.');
    };


    _p._manageElementRuleChanges = function(element, newRuleKey) {
        var lastRuleKey;
        if(this._lastElementRules.has(element)) {
            lastRuleKey = this._lastElementRules.get(element);
            if(lastRuleKey === newRuleKey)
                // nothing to do, because nothing changed
                return;
            // clean up, lastRuleKey is now outdated
            if(this._rules[lastRuleKey])
                this._rules[lastRuleKey][2].delete(element);
        }

        if(newRuleKey === null || newRuleKey === undefined)
            // no newRuleKey
            this._lastElementRules.delete(element);
        else
            this._lastElementRules.set(element, newRuleKey);
    };

    /**
     * Used from within _createStyleDict and StyleDict, don't use it
     * anywhere else! This is not cached here and pretty expensive.
     * If needed we will add a rules property getter to StyleDict.
     */
    _p.getRulesForElement = function(element) {
        var ruleKey = this.getCPSName(element)
          , propertyCollection
          , subscriptionID
          , rules
          ;
        this._manageElementRuleChanges(element, ruleKey);

        // An element needs not have any rules attached to it
        if(ruleKey === null)
            return [];
        if(!this._rules[ruleKey]) {
            // subscribe only once, this saves calling us a lot of handlers
            // for each styledict
            // we are currently not unsubscribing, because we don't
            // unload propertyCollections ever.
            // TODO: unload propertyCollections if they are not used anymore.
            //       Probably add a reference counter for that. Maybe this
            //       is better done in _ruleController. The unsubscription
            //       here could happen on('destroy');
            propertyCollection = this._ruleController.getRule(false, ruleKey);
            subscriptionID = propertyCollection.on('structural-change', [this, '_updateRule'], ruleKey);
            this._rules[ruleKey] = [propertyCollection, subscriptionID, new Set()];
        }
        else
            propertyCollection = this._rules[ruleKey][0];

        rules = this._selectorEngine.getMatchingRules(propertyCollection, element);
        this._rules[ruleKey][2].add(element);
        return rules;
    };

    _p._getStyleDict = function(element) {
        var data = this._elementsData.get( element );
        // undefined or a StyleDict instance
        return data && data[0];
    };

    _p._checkElementRules = function(element) {
        var styleDict = this._getStyleDict( element );
        if(styleDict)
            //styleDict.invalidateRules();
            styleDict.checkRules();
    };

    _p._checkElementRulesHandler = function(element) {
        this._checkElementRules(element);
        element.walkTreeDepthFirst(this._checkElementRules.bind(this));
    };

    _p._createStyleDict = function(element) {
        // rules will be pulled lazily by styleDict, when needed
        var rules = null // rules = this.getRulesForElement(element)
          , styleDict = new this.StyleDict(this, element, rules)
           // Changes in the elements "id", "index", "classes" must trigger
           // styleDict.checkRules in elements and all descendants,
           // (if they have a styleDict already.)
           // This is because these properties can change which rules apply
           // to the element and its children.
           // Even when the index does not change, a change in the parents
           // children list can change the properties. If this element
           // consumes a rule via negative index, e.g: `:i(-1)`, and then
           // another rule is appended to the parent, then this element is
           // not last anymore, and the rule is misscached. Thus I added
           // the key 'tail-index' for onPropertyChange.
          , subscription = element.onPropertyChange(['index', 'tail-index', 'classes', 'id']
                                , [this, '_checkElementRulesHandler'], element)
          ;
        this._elementsData.set(element, [styleDict, subscription]);
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
        // this._styleDicts cache set in _createStyleDict
        return this._getStyleDict(element) || this._createStyleDict(element);
    };

    /**
     * Update each styleDict that uses the rule called `ruleKey`
     */
    _p._updateRule = function(ruleKey) {
        var elements = Array.from(this._rules[ruleKey][2])
          , styleDict
          , i, l
          ;
        for(i=0,l=elements.length;i<l;i++) {
            styleDict = this._getStyleDict( elements[i] );
            // This is actually not true, because getRulesForElement
            // is a public interface and it doesn't create the styledict
            // but, the way it is used now, this is true, and I want to
            // find posssible bugs related to this miss behavior.
            // FIXME: maybe getRules for element should create the styleDict
            // or _createStyleDict should register the element in this._rules,
            // or we just continue here when everything looks alright after
            // a while.
            assert(!!styleDict, 'Element must have a StyleDict when it\'s '
                                                + 'associated with a rule');
            styleDict.checkRules();
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

    _p.purgeNode = function(node) {
        var nodes = [], element = node, elementData;
        if(node.parent)
            throw new CPSError('Can\'t purge when node has a parent.');
        do {
            // remove the styleDict and all references to it
            this._manageElementRuleChanges(element, null);

            elementData = this._elementsData.get(element);
            if(elementData) {
                element.offPropertyChange(elementData[1]);
                elementData[0].invalidateRules();
                this._elementsData.delete(element);
            }

            // do this for all children as well
            Array.prototype.push.apply(nodes, element.children);
        } while((element = nodes.pop()));
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
