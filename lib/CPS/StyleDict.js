define([
    'Atem-CPS/errors'
  , 'Atem-CPS-whitelisting/whitelisting'
  , 'Atem-CPS/emitterMixin'
  , 'Atem-CPS/OMA/_Node'
  , './elements/SelectorList'
], function(
    errors
  , whitelisting
  , emitterMixin
  , _OMANode
  , SelectorList
) {
    "use strict";

    var KeyError = errors.Key
      , ReceiverError = errors.Receiver
      , AssertionError = errors.Assertion
      , CPSKeyError = errors.CPSKey
      , CPSRecursionKeyError = errors.CPSRecursionKey
      , assert = errors.assert
      , propertyChangeEmitterSetup
      ;

    propertyChangeEmitterSetup = {
          stateProperty: '_dependants'
        , onAPI: 'onPropertyChange'
        // TODO: Not deleting the channel will take a bit more memory but in turn
        // needs less garbadge collection
        // we could delete this when the key is removed from this._dict
        // and not added again, supposedly in _rebuildIndex and _propertyChangeHandler
        // delete this._dependants[key];
        // however, _rebuildIndex and updateDictEntry are not part of
        // the concept of emitter/channel thus the emitter should
        // provide a method: removeProperty(channel) which in turn can be called by
        // _rebuildIndex and updateDictEntry. Also, that would throw an error
        // if there are any subscriptions left. (we may add a on-delete event)
        // for that case!?
        , offAPI: 'offPropertyChange'
        , triggerAPI: '_triggerPropertyChange'
    };

    /**
     * StyleDict is an interface to a List of CPS.Rule elements.
     *
     * rules: StyleDict will pull the rules for element from controller
     *        when needed, it uses controller.getRulesForElement(element)
     *        controller, in turn will invalidate the rules via: StyleDict.prototype.invalidateRules
     */
    function StyleDict(controller, element, rules /* default: null */) {
        // I prefer: this.get.bind(this);
        // But this method is called a lot and thus the closure is faster.
        // see: http://jsperf.com/bind-vs-native-bind-run
        // that may change in the future
        var self = this;

        // new GetAPI(this); => would make a cleaner definition, but maybe slows things down???
        this.getAPI = {
            get: function(key) {
                self._subscribeTo(self, key);
                return self.get(key);
            }
          , query: function(node, selector) {
                self._subscribeTo(node, selector);
                return node.query(selector);
            }
          , genericGetter: function(item, key){
                return self._genericGetter(item, key);
            }
        };


        Object.defineProperty(this, 'element', {
            value: element
          , enumerable: true
        });
        this._controller = controller;
        this._getting = {
            recursionDetection: Object.create(null)
          , stack: []
          , current: null
        };

        this._rules = rules || null;
        this._dict = null;
        this._cache = Object.create(null);

        // subscriptions to the "add" channel of each propertyDict in this._rules
        this._dictSubscriptions = [];

        // subscriptions to the active key in a propertyDict
        //
        // triggered on "change" and "delete" (also on "add" but we subscribe later)
        //
        // cache_key refers to the same key here and in the propertyDict
        // {
        //    cache_key: [propertyDict, subscriptionUid] /* information needed to unsubscribe */
        // }
        this._propertySubscriptions = Object.create(null);

        // All current subscriptions to dependencies of the cache.
        // One subscription can be used by many _cache entries.
        // {
        //    subscriptionUid: [
        //        /* information needed to unsubscribe */
        //          item // the item/element/object subscribed to
        //        , subscriberId // needed to unsubscribe, returned when subscribing
        //
        //        /* information to control subscribing and unsubscribing */
        //        , object // set of _cache keys subscribed to this
        //        , 0 // counter, number of dependencies, same as previous Object.keys(object).length
        //    ];
        //}
        this._cacheSubscriptions = Object.create(null);

        // the subscriptionUids for each key in cache
        // {
        //    cache_key: [subscriptionUid, ...]
        // }
        this._cacheDependencies = Object.create(null);

        // emitter: PropertyChange
        // Adds this[propertyChangeEmitterSetup.stateProperty]
        // which is this._dependencies
        emitterMixin.init(this, propertyChangeEmitterSetup);

        // adds the default this._channel
        emitterMixin.init(this);

        this._subscriptionUidCounter = 0;
        this._subscriptionUids = new WeakMap();
        this._invalidating = 0;

        // we can prepare this callback once for all channels
        // see also _p._nextTrigger
        this._delayedTriggerData = Object.create(null);
        this.__delayedTrigger = this._delayedTrigger.bind(this);
    }

    var _p = StyleDict.prototype;
    _p.constructor = StyleDict;

    /**
     * adds the methods:
     *    onPropertyChange(propertyName, subscriberData) // returns subscriptionId
     *    offPropertyChange(subscriptionId)
     *    _triggerPropertyChange(propertyName, eventData)
     *
     * these are used mostly for inter-StyleDict communication / cache invalidation
     */
    emitterMixin(_p, propertyChangeEmitterSetup);

    /**
     * adds the methods:
     *    on(channel, subscriberData) // returns subscriptionId
     *    off(subscriptionId)
     *    _trigger(channel, eventData)
     */
    emitterMixin(_p);

    _p._getSubscriptionUid = function(item, key) {
        var uid;
        if(item instanceof _OMANode) {
            if(key instanceof SelectorList)
                // TODO: currently all subtree changes are handled as one.
                // I think we may become finer grained here. Like for example
                // only fire if a change in a subtree affects the result
                // of item.query(key); then, the SubscriptionUid must be
                // different for different selectors. Until then all selectors
                // for a _OMANode have the same SubscriptionUid:
                return item.nodeID + 'S:$';// + key
            else
                return item.nodeID + ':' + key;
        }
        else if(item instanceof StyleDict)
            return '!' + item.element.nodeID + ':' + key;
        // fallback, rare cases
        uid = this._subscriptionUids.get(item);
        if(!uid) {
            uid = '?' + (this._uidCounter++) + ':' + key;
            this._subscriptionUids.set(item, uid);
        }
        return uid;
    };

    _p._unsubscribeFromAll = function(key) {
        // we have probably collected dependencies for this cache, since
        // the cache is now invalidated, the dependencies can be unsubscribed
        var dependencies = this._cacheDependencies[key]
          , subscriptionUid
          , subscription
          , i, l
          ;
        if(!dependencies)
            return;
        for(i=0,l=dependencies.length;i<l;i++) {
            subscriptionUid = dependencies[i];
            subscription = this._cacheSubscriptions[subscriptionUid];
            // remove dependency key from subscription
            delete subscription[2][key];//index
            subscription[3]--;//counter
            if(subscription[3])
                continue;
            // no deps left
            subscription[0].offPropertyChange(subscription[1]);
            delete this._cacheSubscriptions[subscriptionUid];
        }
        delete this._cacheDependencies[key];
    };

    /**
     *  if key is in cache, invalidate the cache and inform all subscribers/dependants
     */
    _p._invalidateCache = function(key) {
        // NOTE:
        // This event should fire whenever the value of the dict
        // changed in a way, so that e.g. a redraw of a glyph is needed
        // _invalidateCache seems resonable at the moment, but it might be
        // a source of subtle bugs, when the event was not fired but should
        // have been. So keep an eye on this.
        this._nextTrigger('change', key);

        if(!(key in this._cache)) {
            // Looks like this is history now. I'm keeping the assertion
            // however to spot regressions.
            assert(!this._cacheDependencies[key] || !this._cacheDependencies[key].length
                , 'Because the key "' + key + '" is not cached, there must not be any dependency or dependant');
            return;
        }
        // remove this this._invalidatingKeys when there are no errors
        if(!this._invalidatingKeys)
            this._invalidatingKeys = Object.create(null);
        assert(!(key in this._invalidatingKeys), 'Key ' + key + 'is beeing invalidated at the moment: '+ Object.keys(this._invalidatingKeys));
        this._invalidatingKeys[key] = true;


        this._invalidating +=1;
        delete this._cache[key];
        this._unsubscribeFromAll(key);
        this._triggerPropertyChange(key);
        this._invalidating -= 1;
        delete this._invalidatingKeys[key];
        assert(!(key in this._cache), '"'+key + '" was just deleted, '
                    + 'yet it is still there: ' + Object.keys(this._cache));
    };

    /**
     * Schedule an event to fire after all synchronous tasks are finished
     * using a simple setTimeout(,0); a subsequent call to this._nextTrigger
     * will delay the timeout again and add it's data to the scheduled data.
     *
     * For now this is enough debouncing, however, we may need better
     * mechanics in the future.
     */
    _p._nextTrigger = function(channelKey, data) {
        /*global setTimeout:true, clearTimeout:true*/
        // FIXME: use https://github.com/YuzuJS/setImmediate/blob/master/setImmediate.js
        //        instead of setTimeout, everywhere not just here!
        var channel = this._delayedTriggerData[channelKey];
        if(!channel)
            channel = this._delayedTriggerData[channelKey] = {
                timeoutID: null
              , data: []
            };
        if(arguments.length > 1)
            channel.data.push(data);
        if(channel.timeoutID)
            return;
            // all _nextTrigger calls will hapen during one synchronous process
            // so there's no need to clearTimeout
            // FIXME: TODO: in the future there may be asynchronisity introduced
            // via the renderer. Then we should switch to a promise that triggers
            // when it's done (using the "then" interface of the promise)
            // clearTimeout(channel.timeoutID);

        channel.timeoutID = setTimeout(this.__delayedTrigger, 0, channelKey);
    };

    /**
     * This is only ever called via _nextTrigger and the
     * this.__delayedTrigger bound method
     */
    _p._delayedTrigger = function(channelKey) {
        var channel = this._delayedTriggerData[channelKey];
        if(!channel)
            throw new AssertionError('The data for "'+ channelKey +'" is missing.');
        delete this._delayedTriggerData[channelKey];
        this._trigger(channelKey, (channel.data.length ? channel.data : undefined));
    };

    _p._invalidateCacheHandler = function(subscriptionUid) {
        assert(subscriptionUid in this._cacheSubscriptions, 'must be subscribed now');
        var dependencies = Object.keys(this._cacheSubscriptions[subscriptionUid][2])
          , i, l
          ;
        for(i=0,l=dependencies.length;i<l;i++)
            this._invalidateCache(dependencies[i]);
        assert(!(subscriptionUid in this._cacheSubscriptions), 'must NOT be subscribed anymore');
    };

    _p._subscribeTo = function(item, key) {
        var subscriberId
          , subscriptionUid = this._getSubscriptionUid(item, key)
          , current = this._getting.current
          , dependencies = this._cacheSubscriptions[subscriptionUid]
          , propertyName
          ;
        // add dependency current to subscriptionUid
        if(!dependencies) {
            if(typeof item.onPropertyChange !== 'function') {
                // NOTE, when the value at item[key] can change, that
                // onPropertyChange and offPropertyChange must be implemented
                // when item is "immutable", we don't need this
                return;
            }
            else {
                if(key instanceof SelectorList) {
                    assert(item instanceof _OMANode, 'When "key" is a Selector '
                                        +'"item" must be an OMA Node.');
                    // subtree is kind of a virtual property
                    propertyName = 'subtree';
                    // TODO: Can this be controlled finer?
                    // Se also the comment in _getSubscriptionUid at
                    //`if(key instanceof SelectorList)`
                }
                else
                    propertyName = key;
                subscriberId = item.onPropertyChange(propertyName, [this, '_invalidateCacheHandler'], subscriptionUid);
            }
            dependencies = this._cacheSubscriptions[subscriptionUid]
                         = [item, subscriberId, Object.create(null), 0];
        }
        else if(current in dependencies[2])
            // that cache already subscribed to item.key
            return;
        dependencies[2][current] = true;//index
        dependencies[3] += 1;// counter

        if(!this._cacheDependencies[current])
            this._cacheDependencies[current] = [];
        this._cacheDependencies[current].push(subscriptionUid);
    };

    _p._genericGetter = function (item, key) {
        var result;
        if(item === undefined) {
            // used to be a
            // pass
            // is this happening at ALL?
            // in which case?
            // is that case legit?
            // console.trace();
            // Note: we can't subscribe to this, so it is a fatal case.
            // No subscription means we can't recover
            throw new Error('trying to read "'+key+'" from an undefined item');
        }
        else if(item instanceof _OMANode) {
            var cs = item.getComputedStyle();
            this._subscribeTo(cs, key);
            result = cs.get(key);
        }
        else if(item.cpsGet) {
            // FIXME:
            // do we need this case at all? probably when item is a
            // PenStrokePoint.skeleton and key is on/in/out
            // I don't know if there's another case
            // This means, however that everything that has a cpsGet
            // will have to provide a `onPropertyChange` API (which makes totally sense)
            // arrays are obviously exceptions...
            // so, the do we need this subscription at all question arises again
            //
            // FIXME: can't we just not subscribe to this and do the same as with array
            // that is the original source of item must be subscribed to and =
            // fire if item changes...
            // it is probably happening in __get anyways, like this
            // cpsGetters.whitelist(this.element, key);
            // and then a this._subscribeTo(this.element, key)
            // REMEMBER: this code was extracted from a merge of
            // cpsGetters.generic plus cpsGetters.whitelist
            // so, in the best case, we wouldn't use this condition at all,
            // I think
            this._subscribeTo(item, key);
            result = item.cpsGet(key);
        }
        else if(item instanceof Array)
            result = whitelisting.arrayGet(item,key);
            // no subscription! the source of the Array should be subscribed
            // to and fire when the array changes
        else
            throw new KeyError('Item "'+item+'" doesn\'t specify a whitelist for cps, trying to read '+key);
        return result;
    };

    _p._fetchNewRules = function() {
        // Both, a rule and the element provide the `properties` interface.
        // Thus, "rules" is not exactly right here, we also have the
        // element in here.
        var rules = [[null, this.element, null]];
        Array.prototype.push.apply(rules,
                        //this call is most expensive
                        this._controller.getRulesForElement(this.element));
        return rules;
    };

    _p._loadRules = function(force) {
        var rules;
        if(this._rules === null || force)
            this._rules = this._fetchNewRules();
    };

    _p.getRules = function(includeElementProperties) {
        if(!this._dict) this._buildIndex();
        return this._rules.slice(includeElementProperties ? 0 : 1);
    };

    /**
     * Loads the rules if missing.
     * Initializes and indexes this._dict
     * Subscribes to propertyDict and property changes and updates
     */
    _p._buildIndex = function() {
        assert(this._dict === null, 'Index already initialized, run invalidateRules to purge it.');
        var i, l, j, ll, keys, key, properties, subscriberID;
        this._loadRules();
        this._dict = Object.create(null);
        for(i=0,l=this._rules.length;i<l;i++) {
            properties = this._rules[i][1].properties;

            subscriberID = properties.on('add', [this, '_propertyAddHandler'], i);
            this._dictSubscriptions.push([properties, subscriberID]);
            subscriberID = properties.on('update', [this, '_propertyUpdateHandler'], i);
            this._dictSubscriptions.push([properties, subscriberID]);


            keys = properties.keys();
            for(j=0, ll=keys.length; j<ll; j++) {
                key = keys[j];
                if(!(key in this._dict))
                    this._setDictValue(properties, key, i);
            }
        }
    };

    _p._unsubscribeFromDicts = function(){
        var i, l, subscription;
        for(i=0,l=this._dictSubscriptions.length;i<l;i++) {
            subscription = this._dictSubscriptions[i];

            // Uncaught UnhandledError: EmitterError:
            // Unsubscription without subscription from channel:
            //                  "add" with subscriberID: "1"
            subscription[0].off(subscription[1]);
        }
        this._dictSubscriptions = [];
    };

    _p._rulesEqual = function(rulesA, rulesB) {
        var i,l, rA, rB;
        if(rulesA.length !== rulesB.length)
            return false;
        for(i=0,l=rulesA.length;i<l;i++) {
            // rules[i] === [selectors, item, trace]
            // this._rules[i][1].properties is the really important item
            // at the moment. but an item that provides the `properties`
            // key make sure that the identity of the propertyDict doesn't
            // change (immutable). This is the case in
            // OMA/_Node and CPS/elements/Rule
            // FIXME: selectors and trace are right now used for UI/display
            // purposes are not changed now. We should handle changes there
            // as well! However, that should not change the speed gains that
            // we have from using checkRules over invalidateRules.
            // For now I accept this under-impelementation and not-updating
            // of the UI, to get the current tasks up and runnning.
            // Something like a set of appropriate events would be good.
            // Maybe ('ruleChanged', 'selectors') and ('ruleChanged', 'trace')
            // or such.
            if(rulesA[i][1] !== rulesB[i][1])
                return false;
        }
        return true;
    };

    /**
     * This is a different approach to invalidateRules. The strategy is
     * to be cheaper in the end, because we may not have to invalidate
     * all the caches if the new rules are not different from the old ones.
     *
     * However, we have to run the expensive call to this._getNewRules
     * instantly and can not postpone it, until it is really needed.
     *
     * But if there are rules now it is likely that they are used somewhere
     * and must update anyways. If there are no rules now, we don't fetch
     * new ones.
     *
     * FIXME: measure performance. Keep in mind that checkRules
     * may perform better when there are many dependencies
     * to the styleDict. However, when there are many subsequent
     * calls (tail-index changes a lot when items are added)
     * it may be cheaper to use invalidateRules for some cases
     * because that loads rules lazily when querried. When invalidateRules
     * is called subsequently without styleDict.get in between.
     * it should be cheaper. checkRules must get the
     * rules each time from selector engine which itself
     * is expensive. Having many rules to select from could
     * also move the benchmark in favor of invalidateRules,
     * if there are subsequent calls to it.
     */
    _p.checkRules = function() {
        if(!this._rules)
            // the rules will be loaded lazily when requested
            return;
        var newRules = this._fetchNewRules();
        if(this._rulesEqual(this._rules, newRules))
            return;
        this._setRules(newRules);
    };

    _p._invalidateDict = function() {
        var key;
        for(key in this._dict) {
            this._unsetDictValue(key);
            this._invalidateCache(key);
        }
        // needed if this._dict had no keys previously
        // because then this._invalidateCache would not run
        // for example when the rules changed from not providing keys to
        // now providing keys
        this._nextTrigger('change');
        this._dict = null;
    };

    /**
     * Use this when the PropertyCollection of this styleDict
     * changed so much that the this._rules (rules) list needs to be rebuild
     *
     * Changes in the PropertyCollection that are of this kind are:
     * added or removed Rules
     * SelectorList changes (it's always replacement) of Rules OR AtNamespaceCollections
     * A reset of the PropertyCollection (which does all of the above)
     *
     * The value of this StyleDict may not change, see therefore this.checkRules
     *
     * This doesn't include add/remove events of properties/propertyDicts,
     * we'll handle that on another level.
     *
     * if rules === null this._buildIndex (there this._loadRules) will
     * load them lazily.
     * this._buildIndex will be called lazily anyways.
     */
    _p._setRules = function(rules) {
        this._rules = rules || null;
        this._unsubscribeFromDicts();
        this._invalidateDict();
    };

    /**
     * invalidate the rules and let this._buildIndex fetch them lazily when
     * needed.
     */
    _p.invalidateRules = function() {
        this._setRules(null);
    };

    // not in use now
    _p._rebuildIndex = function() {
        this._invalidateDict();
        this._buildIndex();
    };

    _p._propertyUpdateHandler = function(data, channelKey, keys) {
        // If any of the propertyDicts fired it's update event we pass it along here
        // update, in contrast to change is fired when the propertyDict
        // changed but did not change it's value.
        // This is used for rendering in the ui only.
        this._nextTrigger('update');
    };

    /**
     * properties.onPropertyChange wont trigger on "add", because we won't
     * have subscribed to it by then.
     */
    _p._propertyAddHandler = function(data, channelKey, keys) {
        var i, l;
        for(i=0,l=keys.length;i<l;i++)
            this.__propertyAddHandler(data, channelKey, keys[i]);
    };

    _p.__propertyAddHandler = function(data, channelKey, key) {
        var newRuleIndex = data
          , currentRuleIndex = this._propertySubscriptions[key]
                    ? this._propertySubscriptions[key][2]
                    : undefined
          ;

        // Note: the lower index is more specific and must be used.
        // These are the indexes in this._rules of course. More specific
        // indexes come first.
        if(newRuleIndex > currentRuleIndex)
            return;
        else if(newRuleIndex < currentRuleIndex) {
            this._unsetDictValue(key);
            this._invalidateCache(key);
        }
        else if(currentRuleIndex === newRuleIndex)
            // When both are identical this means we don't have an "add"
            // event by definition! Something in the programming logic went
            // terribly wrong.
            throw new AssertionError('The old index must not be identical '
                        + 'to the new one, but it is.\n index: ' + newRuleIndex
                        + ' key: ' + key
                        + ' channel: ' + channelKey);
        this._setDictValue(this._rules[newRuleIndex][1].properties, key, newRuleIndex);
    };

    _p._setDictValue = function(properties, key, propertiesIndex) {
        assert(!(key in this._propertySubscriptions), 'there may be no dependency yet!');
        var subscription = this._propertySubscriptions[key] = [];
        this._dict[key] = properties.get(key);
        subscription[0] = properties;
        subscription[1] = properties.onPropertyChange(key, [this, '_propertyChangeHandler'], properties);
        subscription[2] = propertiesIndex;
    };

    _p._unsetDictValue = function(key) {
        var subscription = this._propertySubscriptions[key];
        subscription[0].offPropertyChange(subscription[1]);
        delete this._dict[key];
        delete this._propertySubscriptions[key];
    };

    /**
     *  remake the this._dict entry for key
     */
    _p._updateDictEntry = function(key) {
        var i, l, properties;
        this._unsetDictValue(key);
        for(i=0,l=this._rules.length;i<l;i++) {
            properties = this._rules[i][1].properties;
            if(!properties.has(key))
                continue;
            this._setDictValue(properties, key, i);
            break;
        }
        this._invalidateCache(key);
    };

    _p._propertyChangeHandler = function(properties, key, eventData) {
        switch(eventData) {
            case('change'):
                // The value is still active and available, but its definition changed
                this._dict[key] = properties.get(key);
                this._invalidateCache(key);
                break;
            case('delete'):
                // the key of properties was removed without replacement
                // remove the entry and look for a new one
                this._updateDictEntry(key);
                break;
            default:
                throw new ReceiverError('Expected an event of "change" or '
                                       + '"delete" but got "'+eventData+'" '
                                       + '(propertyChangeHandler for "'+key+'")');
        }
    };

    Object.defineProperty(_p, 'keys', {
        get: function() {
            if(!this._dict) this._buildIndex();
            return Object.keys(this._dict);
        }
    });

    /**
     * Return an instance of PropertyValue or null if the key is not defined.
     */
    _p._getProperty = function(key) {
        if(!this._dict) this._buildIndex();
        return (key in this._dict) ? this._dict[key] : null;
    };

    _p.__get = function(key, errors) {
        var param = this._getProperty(key)
          , result
          ;
        if(param) {
            result = param.value.evaluate(this.getAPI);
            // _validator should throw ValueError if invalid, but StyleDict
            // will make a KeyError out of almost any error, regardless.
            // _validator may perform post processing on the result e.g.
            // if  it eases further usage of the value. It's the decision
            // of the app author. If not, validator must return the result
            // unaltered on success.
            return this.element.checkPropertyValue(key, result);
        }
        // This will become part of the error message if the following
        // attempt to read the key raises an error. Otherwise there is
        // no error, because a value was found.
        errors.push(key + ' not found for ' + this.element.particulars);
        // Reading from the OMA node directly.
        // At the moment this is a placeholder. There is no onPropertyChange
        // method for OMA-Nodes present yet.
        this._subscribeTo(this.element, key);
        // will throw KeyError if key can't be returned
        result = this.element.cpsGet(key);


        return result;
    };
    /**
     * Look up a property in this.element according to the following
     * rules:
     *
     * 1. If `key' is "this", return the OMA Element of this StyleDict
     * (this.element). We check "this" first so it can't be overridden by
     * a @dictionary rule.
     *
     * 2. If `key' is defined in CPS its value is returned.
     *
     * 3. If key is available/whitelisted at this.element, return that value.
     *
     * 4. throw KeyError.
     *
     * If `key' is a registered property type, the return value's type is
     * the property type or an error will be thrown;
     * Otherwise, the return value may be anything that is accessible
     * or constructable from CPS formulae, or a white-listed value on
     * any reachable element.
     */
    _p._get = function(key) {
        var errors = [], getting;
        if(key === 'this')
            return this.element;
        getting = this._getting;

        if(key in getting.recursionDetection)
            throw new CPSRecursionKeyError('Looking up "' + key
                            + '" is causing recursion in the element: '
                            + this.element.particulars);

        getting.recursionDetection[key] = true;
        getting.stack.push(getting.current);
        getting.current = key;
        try {
            return this.__get(key, errors);
        }
        catch(error) {
            // PropertyLanguageError, KeyError, ValueError are caught here for
            // example. It is however hard to expect from the current users
            // of StyleDict to differentiate between the myriad of possible
            // ErrorTypes, leaving unprepared code in a bad situation!
            // Maybe we can establsish that StyleDict triggers an event
            // when it has erroneous entries, so an external observer/UI
            // could inform the user and show the correct place to act.
            //
            // Casting anything to KeyError means that we don't get much
            // information from a failing get. However, a normal user only
            // needs to know that there was a fail.
            // It is in a way an appropriate answer. It is however
            // crucial to develop a way to deal with the details of these
            // errors (see above: external observer/UI).
            if(error instanceof AssertionError)
                // This hints to a programming error. We really want this
                // to be annoing so that it gets fixed soon.
                throw error;
            errors.push(error);
            if(error instanceof CPSRecursionKeyError)
                throw error;
            throw new KeyError(errors.join('\n----\n'), errors[0] && errors[0].stack || undefined);
        }
        finally {
            delete getting.recursionDetection[key];
            getting.current = getting.stack.pop();
        }
    };
    /**
     * If the property at "key" does not exist or is otherwise faulty,
     * default is returned if provided, otherwise KeyError is raised.
     *
     * Also CPSRecursionKeyError appears but that is an instance of KeyError.
     *
     * Even using "default" won't guard from AssertionErrors. These errors
     * point to programming mistakes and need to be taken care off, so we
     * want them to be annoing ;)
     */
    _p.get = function(key/* [ , defaultVal optional ] */) {
        if(this._invalidating)
            throw new AssertionError('This is invalidating, so get is illegal: '
                    + this.element.type + ' ' + this.element.nodeID);

        var val = this._cache[key], hasDefault, defaultVal;
        hasDefault = arguments.length >= 2;
        if(hasDefault) defaultVal = arguments[1];
        // Replay the behavior when asked for this thing the first time.
        // Also, all cache subscriptions bound to a cache entry are still
        // related. Without this we had problems with an assertion in
        // _invalidateCache.
        if(val instanceof Error) {
            if(hasDefault) return defaultVal;
            throw val;
        }
        else if(val !== undefined)
            return val;
        // no cache hit, query it
        try {
            this._cache[key] = val = this._get(key);
        }
        catch(error) {
            if(error instanceof CPSRecursionKeyError) {
                // this is pre querying key
                if(hasDefault) return defaultVal;
                throw error;
            }
            else {
                // throw only real Errors! (how else could we easily cache
                // errors next to legit values)
                assert(error instanceof Error, 'Caught something, but it is not an instance of Error: ' + error);
                this._cache[key] = error;
                if(hasDefault) return defaultVal;
                throw error;
            }
        }
        return val;
    };

    return StyleDict;
});
