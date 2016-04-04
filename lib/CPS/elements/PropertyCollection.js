define([
    'Atem-CPS/errors'
  , './_Node'
  , './SelectorList'
  , './Rule'
  , './Comment'
], function(
    errors
  , Parent
  , SelectorList
  , Rule
  , Comment
) {
    "use strict";
    var CPSError = errors.CPS
      , ValueError = errors.Value
      ;
    /**
     * A list of Rule, PropertyCollection (also @namespace, @import) and
     * Comment Elements
     */
    function PropertyCollection(items, source, lineNo) {
        Parent.call(this, source, lineNo);
        this._items = [];

        this._subscriptions = new Map();

        this._name = null;
        this._rules = null;
        this._rulesCacheSubscriptions = [];
        if(!this._allowNamespace) {
            // lock this.name
            this.name = undefined;
        }
        // insert the items.
        // triggers structural-change
        this.splice(0, 0, items);
    }
    var _p = PropertyCollection.prototype = Object.create(Parent.prototype);
    _p.constructor = PropertyCollection;

    // called in RuleController._set
    _p.reset = function(/* same as constructor ! */) {
        // the internal method won't trigger anything.
        var result = this._splice(0, this._items.length);

        // reset all own, enumerable, configurable properties
        Object.keys(this).forEach(function(key) {
            if(Object.getOwnPropertyDescriptor(this, key).configurable)
                delete this[key];
        }, this);

        if(result[1]) this._trigger('delete');
        // This will trigger structural-change the reset brought
        // any items, also "add" will be triggered then.
        this.constructor.apply(this, arguments);
        // if the reset did not add items, but we deleted any
        if(result[1] && !this._items.length) this._trigger('structural-change');
    };

    _p.toString = function() {
        return this._items.join('\n\n');
    };

    /**
     * subclasses of this will have to overide this definition
     */
    Object.defineProperty(_p, 'invalid', {
        value: false
    });

    /**
     * for display in the ui
     */
    Object.defineProperty(_p, 'items', {
        get: function(){return this._items.slice();}
    });

    Object.defineProperty(_p, 'length', {
        get: function(){ return this._items.length;}
    });

    Object.defineProperty(_p, 'name', {
        enumerable: true
      , get: function() {
            return (this._name ? this._name : null);
        }
      , set: function(name) {
            if(this._name !== null)
                throw new CPSError('Name is already set: ' + this._name);
            if(name === undefined) {
                this._name = undefined;
                return;
            }
            else if(typeof name !== 'string')
                throw new CPSError('Name has the wrong type, expected '
                    + 'string but got: '
                    + (name.constructor
                        ? name.constructor.name
                        : name + ' typeof: ' + (typeof name)));
            this._name = name;
        }
    });

    /**
     * this returns all rules that are direct children of this collection
     * AND all rules of PropertyCollection instances that are
     * direct children of this collection, a "flattened" list in the form:
     * [
     *    [namespace Selectorlist, Rule]
     *  , [namespace Selectorlist, Rule]
     *  , ...
     * ]
     *
     */
    Object.defineProperty(_p, 'rules', {
        get: function() {
            if(!this._rules)
                this._rules = this._getRules();
            return this._rules;
        }
    });

    _p._subscribeItem = function(item) {
        var callback, channel;
        if(item instanceof Rule)
            channel = 'selector-change';
        else if(item instanceof PropertyCollection)
            channel = 'structural-change';
        else
            return;
        callback = [this, '_itemChangeHandler'];
        this._subscribe(item, ['update', channel], callback);
    };

    _p._subscribe = function(item, channel, callback, data) {
        var subscriptionID = item.on(channel, callback, data);
        this._subscriptions.set(item, subscriptionID);
    };

    _p._unsubscribe = function(item) {
        var subscriptionID = this._subscriptions.get(item);
        if(!subscriptionID) return;
        item.off(subscriptionID);
        this._subscriptions.delete(item);
    };

    _p._itemChangeHandler = function(data, channelName, eventData) {
        //jshint unused:vars
        if(channelName === 'update')
            this._trigger('update');
        else
            this._trigger('structural-change');
    };


    function _checkItem(item) {
        return (
                (item instanceof Rule && !item.invalid)
             || (item instanceof PropertyCollection && !item.invalid)
             || item instanceof Comment
        );
    }

    /**
     * FIXME: this is copy and pasted from models/PropertyDict but the
     *        implementation should be shared!
     *
     * Calculate the start index where Array.prototype.splice really starts.
     *
     * > start:
     * > Index at which to start changing the array. If greater than the
     * > length of the array, actual starting index will be set to the
     * > length of the array. If negative, will begin that many elements
     * > from the end.
     *
     * Not in that documentation, if negative after length-start: start = 0
     */
    _p._getCanonicalStartIndex = function(start, length) {
        if(start >= length)
            return length;
        if(start < 0)
            return Math.max(0, length - start);
        return start;
    };

    _p._splice = function(startIndex, deleteCount, _insertions /* single item or array of items */) {
        var insertions = _insertions instanceof Array
            ? _insertions
            : (_insertions === undefined
                    ? []
                    : [_insertions]
              )
          , deleted
          , args
          , i, l
          , item
          , canonicalStartIndex = this._getCanonicalStartIndex(startIndex, this._items.length)
          ;
        for(i=0,l=insertions.length;i<l; i++) {
            item = insertions[i];
            if(!_checkItem(item))
                throw new ValueError('Trying to insert an invalid item: ' + item);
            this._subscribeItem(item);
        }

        args = [startIndex, deleteCount];
        Array.prototype.push.apply(args, insertions);
        deleted = Array.prototype.splice.apply(this._items, args);
        for(i=0,l=deleted.length;i<l;i++) {
            this._unsubscribe(deleted[i]);
            deleted[i].destroy();
        }
        return [canonicalStartIndex, deleted.length, insertions.length, deleted];
    };

    /**
     * One to rule them all:
     *
     * insert a Rule (which must have a valid SelectorList)
     * remove a Rule
     * replace a rule
     * Add/remove @namespace (with valid SelectorList) or @import
     * Add/remove comments
     * Remove invalid hunks of data. <= just don't allow inserting invalid hunks
     *
     * all is done with Array.prototype.splice
     * see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice
     *
     * emits:
     *      "delete" if there where deletions
     *      "add" if there where insertion
     *      "structural-change" if there where insertion or deletions
     */
    _p.splice = function(startIndex, deleteCount, insertions /* single item or array of items */) {
        var result = this._splice(startIndex, deleteCount, insertions)
          , deleted = result[1]
          , inserted = result[2]
          , events = []
          ;
        if(deleted)
            events.push('delete');
        if(inserted)
            events.push('add');
        if(events.length) {
            // FIXME: should this last part be a separate method, that just returns
            // the deleted array? Check the usage of this, see how splice in
            // PropertyDict behaves and is splitted into two methods.
            // NOTE: metapolatorStandAlone.cpsAPITools.addNewRule and addNewAtImport
            // use canonicalStartIndex!
            // (and I just backported propertyDict to comply with this API because
            // it was less effort for the moment)

            // NOTE: now "update" is taken. It is triggered when any "own"
            // item of a PropertyCollection changes. This is meant to trace
            // changes that change the representation of the PropertyCollection
            // itself. I.e. After an "update" event the PropertyCollection
            // source file should be rewritten. In contrast, "structural-change"
            // means the value of the property collection has changed, which
            // included imported PropertyCollections from other files.
            // "structural-change" could still be "deep-update" or so, but it is
            // maybe not such a bad name after all.
            events.push('structural-change', 'update');
            // TODO: Add maybe information like three numbers:
            //      index, deletedCount, insertedCount
            // That could help to update the ui, however, usually a ui is not
            // that delicate!.
            // NOTE: index and deletedCount must be calculated see the
            // docs for Array.prototype.slice
            this._trigger(events);
        }
        return result;
    };

    _p.getItem = function(index) {
        return this._items[index];
    };

    return PropertyCollection;
});
