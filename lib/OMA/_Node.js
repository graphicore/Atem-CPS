define([
    'Atem-CPS/errors'
  , 'Atem-CPS-whitelisting/whitelisting'
  , 'Atem-CPS/emitterMixin'
  , 'Atem-CPS/CPS/elements/PropertyDict'
  , 'bloomfilter'
], function(
    errors
  , whitelisting
  , emitterMixin
  , PropertyDict
  , bloomfilter
) {
    "use strict";

    /*global clearTimeout:true, setTimeout:true */

    var OMAError = errors.OMA
      , ValueError = errors.Value
      ;

    var _id_counter = 0
      , emitterMixinSetup
      , propertyChangeEmitterSetup
      ;

    function getUniqueID() {
        return _id_counter++;
    }

    emitterMixinSetup = {
          stateProperty: '_channel'
        , onAPI: '_on'
        , offAPI: '_off'
        , triggerAPI: '_trigger'
    };

    propertyChangeEmitterSetup = {
          stateProperty: '_dependants'
        , onAPI: 'onPropertyChange'
        , offAPI: 'offPropertyChange'
        , triggerAPI: '_triggerPropertyChange'
    };

    /**
     * The OMA—Object Model API is the base structure against which we can run
     * the selector queries of CPS. We must be able to answer the the question
     * "is this element selected by that selector" for each item of the OMA-Tree.
     *
     * All Elements of a OMA-Tree inherit from _Node.
     * This means, that a test like `item instanceof _Node` must return true.
     */
    function _Node() {
        /*jshint validthis:true*/
        if(this.constructor.prototype === _p)
            throw new OMAError('OMA _Node must not be instantiated directly');
        Object.defineProperty(this, 'nodeID', {value: getUniqueID()});

        this._children = [];
        this._childrenIndexes = new Map();

        // Todo: all these dependencies to parent should be managed together
        // This also includes references to multiverse, universe etc.
        // Managed together means we could store them lazily at a this._parentDeps
        // object and could then bulk delete them when parent changes and such.
        this._parent = null;
        this._index = null;
        this._indexPath = null;
        this._masterIndexPath = null;

        this._id = null;
        this._classes = Object.create(null);
        // FIXME: Will go into SelectorEngine
        this._bloomFilter = null;

        // this has higher precedence than any rule loaded by CPS
        // and it is unique to this _Node.
        // DOM Elements have element.style, this is analogous
        Object.defineProperty(this, 'properties', {
            value: new PropertyDict([], '*element properties*')
          , enumerable: true
        });

        this._changeSubscriptions = null;
        emitterMixin.init(this, emitterMixinSetup);
        emitterMixin.init(this, propertyChangeEmitterSetup);

        this._cpsChange = {
            timeoutId: null
          , eventData: []
          , trigger: this._triggerCpsChange.bind(this)
        };
    }
    var _p = _Node.prototype;
    _p.constructor = _Node;

    /**
     * CPS-Name -> OMA-Name. The keys are used from within CPS. That way
     * the naming decisions in OMA are decoupled from CPS, if needed.
     *
     * Note, if the naming is indeed different, and the OMA properties
     * change then the  _triggerPropertyChange must use the CPS-name.
     *
     * All here white listed properties must trigger _triggerPropertyChange
     * when they change. In some applications some properties never change,
     * then it's not indicated to implement calls to _triggerPropertyChange.
     *
     * "type" can't change ever
     */
    _p._cps_whitelist = {
        parent: 'parent'
      , children: 'children'
      , root: 'root'
      , index: 'index'
      , id: 'id'
      , type: 'type'
    };

    _p.cpsGet = whitelisting.getMethod;
    _p.cpsHas = whitelisting.hasMethod;

    _p._getValidator = function(key) {
        // This is very unspecific on purpose, I can think of lots of
        // options to define validators for different purposes.
        // One of the biggest alternatives was to inject them via
        // the CPS-Controller into StyleDict, which would make the
        // validators of an OMA implementation configurable per application.
        // If that kind of freedom is needed (I think this is rather
        // a bad idea), then the object model could add a setValidator
        // method, operated by the CPS-Controller, for example.
        // However, to make an OM behave constantly across applications
        // (I think this is desirable) it is good to attch these
        // validators to the object model.
        return null;
    };

    /**
     * Used by StyleDict! There is not much use for this elsewhere.
     *
     * Throw ValueError if invalid.
     *
     * (However, StyleDict will make a KeyError out of almost any error,
     * regardless.)
     *
     * checkPropertyValue may perform post processing on the result e.g.
     * if  it eases further usage of the value. It's the decision
     * of the OMA implementor.
     * If not, checkPropertyValue returns the result unaltered on success.
     *
     * The JavaScript `undefined` value is never valid. Instead, `null` can
     * be used. Undefined is very JavaScript specific and often used where
     * other languages would throw errors. `null` has almost the same
     * semantics. If this is going to be implemented in another language
     * I think it's good to have just `null` and never `undefined`.
     */
    _p.checkPropertyValue = function(key, value) {
        var validate = this._getValidator(key)
          , _value = value
          ;

        if(validate)
            // key is in the signature for better error messages
            _value = validate.call(this, key, _value);

        if(_value === undefined)
            throw new ValueError('The formula of "' + key + '" in a ' + this
                            + ' returned `undefined` which is never valid');
        return _value;
    };

    _p.clone = function(cloneElementProperties) {
        var clone = new this.constructor(), i,l;
        this._cloneProperties(clone, cloneElementProperties);
        for(i=0,l=this._children.length;i<l;i++)
            clone.add(this._children[i].clone(cloneElementProperties));
        return clone;
    };

    _p._cloneProperties = function(clone, cloneElementProperties) {
        if(this._id)
            clone.id = this._id;

        clone.setClasses(this._classes);

        if(cloneElementProperties)
            clone.properties.splice( 0, clone.properties.length
                                   , this.properties.items );
    };

    _p.walkTreeDepthFirst = function(callback) {
        var i,l;
        callback(this);
        for(i=0,l=this.children.length;i<l;i++)
            this.children[i].walkTreeDepthFirst(callback);
    };

    emitterMixin(_p, emitterMixinSetup);
    emitterMixin(_p, propertyChangeEmitterSetup);

    /**
     * Implement a getter for CPS Type in children of _Node, we need it
     * for the cps selector engine.
     *
     * cpsType should be a simple string, minuses are ok, don't do
     * anything fancy. Don't use already taken names.
     */
    Object.defineProperty(_p, 'type', {
        get: function() {
            // this should be implemented by items inheriting from _Node
            throw errors.NotImplemented('Implement CPS-Type name!');
        }
    });

    Object.defineProperty(_p, 'children', {
        /**
         * returns a copy of this._children so we can't mess around
         * with the list of children via public interfaces.
         */
        get: function(){ return this._children.slice(); }
    });

    Object.defineProperty(_p, 'id', {
        /**
         * The Mechanism how id's are verified etc. need to be defined,
         * probably on a per OMA-Element base. And probably always the
         * parent is responsible for id checking and setting. At the
         * moment, I need id's to write the selector engine, and for that,
         * I don't need properly checked IDs
         */
        set: function(id) {
            this._bloomFilter = null;
            this._id = id || null;
            this._triggerPropertyChange('id');
        }
      , get: function(){ return this._id; }
    });

    _p._rootType = 'root';

    /***
     * get the root element of this node.
     */
    Object.defineProperty(_p, 'root', {
        get: function() {
            if(!this._parent)
                return null;
            if(this._parent.type === this._rootType)
                return this._parent;
            return this._parent.root;
        }
    });

    /**
     * FIXME: I was always not too happy with this in MOM, for
     *        no particular reason. Maybe it can  be changed a bit.
     *        It's used a lot in MOM, so analyzing for what cases
     *        it's used woud be a good start,
     *
     *
     * returns a selector for this element, currently it is used for
     * display puposes, so the additionial information "(no parent) "
     * is prepended if the item has no parent
     * The selector is valid and selects only this element.
     */
    Object.defineProperty(_p, 'particulars', {
        get: function() {
            return [
                    this._parent ? this._parent.particulars : '(no parent)'
                  , ' '
                  , this.type
                  , (this.id ? '#' + this.id : '')
                  , (this._parent
                        ? ':i(' + this.index + ')'
                        : '')
                ].join('');
        }
    });

    _p.setClass = function(name) {
        this._bloomFilter = null;
        this._classes[name] = null;
    };

    _p.setClasses = function(classes) {
        var i, l;
        for(i=0,l=classes.length;i<l;i++)
            this.setClass(classes[i]);
    };

    _p.removeClass = function(name) {
        this._bloomFilter = null;
        delete this._classes[name];
    };

    _p.hasClass = function(name) {
        return name in this._classes;
    };

    Object.defineProperty(_p, 'classes', {
        get: function() {
            return Object.keys(this._classes);
        }
      , enumerable: true
    });

    _p.toString = function() { return ['<', this.type, '>'].join('');};

    _p.isOMANode = function(item) {
        return item instanceof _Node;
    };

    /**
     *  enhance this list with accepted children Constructors
     */
    _p._acceptedChildren = [];

    _p.qualifiesAsChild = function(item) {
        var i=0;
        if(!this.isOMANode(item) || item === this)
            return false;

        for(;i<this._acceptedChildren.length; i++)
            if(item instanceof this._acceptedChildren[i])
                return true;
        return false;
    };

    /**
     * Note: this is currently running very often when adding or deleting
     * children, I wonder if we need to come up with some tricky shortcut
     * to make the search faster.
     * One thing I already made is searching from back to front, because
     * a child node will call parent.find(this) exactly after beeing
     * added to the parent, to verify that it is indeed entitled to change
     * it's parent property. In that case searching from back to front is
     * the faster path.
     * Maybe a Map item->index is just the thing to do.
     */
    _p.find = function(item) {
        var i = this._childrenIndexes.get(item);
        return i === undefined ? false : i;
    };

    Object.defineProperty(_p, 'index', {
        get: function(){ return this._index;}
    });

    /**
     *  This is used to have an address for the serialization of the
     * _Node.properties. For some applications it may be OK to use
     * unique #ids instead of indexes. I.e. When serializing a master
     * in metapolator its glyph could be indexed by names, and thus
     * make it easier to inspect such a serialization by looking at the
     * file.
     * However, it's not the most important part of this to be human readable.
     * But it could become the second most important part!
     * This method may also be better located at the code that consumes
     * The indexPath! It would reduce the bloat in here.
     */
    Object.defineProperty(_p, 'indexPath', {
        get: function() {
            var indexPath = this._indexPath;
            if(indexPath === null)
                // will be reset by the parent setter
                this._indexPath = indexPath = this.parent.indexPath + '/' + this._index;
            return indexPath;
        }
    });

    Object.defineProperty(_p, 'parent', {
        /**
         * Use parent for reading only.
         *
         * Setting the parent property performs some checks if the new
         * property is indeed valid. The Parent is authoritative in this
         * case.
         *
         * In short: We made it hard to set the parent property because
         * we want you to use the 'add' method of the parent.
         */
        set: function(parent) {
            if(parent === null) {
                if(this._parent === null)
                    // already done
                    return;
                if(this._parent.find(this) !== false)
                    throw new OMAError('Can\'t unset the parent property '
                        +'when the parent still has this Node as a child');

                this._bloomFilter = null;
                this._parent = null;
                this.updateIndex();
                // root depends on parent, as much as index
                this._triggerPropertyChange(['parent', 'root']);
                return;
            }
            else if(this._parent !== null)
                throw new OMAError([this, 'is still a child of a', this._parent
                  , 'you can\'t set a new parent Node. Use "newParent.add(child)"'
                  , 'to move the child to another parent'].join(' '));
            else if (!this.isOMANode(parent))
                throw new OMAError('The parent property must be an OMA Node, '
                    +'but it is: "' + parent + '" typeof: ' + typeof parent);
            else if(parent.find(this) === false)
                throw new OMAError('A OMA Node must already be a child '
                    + 'of its parent when trying to set its parent property. '
                    + 'Use "parent.add(child)" instead.');

            this._bloomFilter = null;
            this._parent = parent;
            this.updateIndex();
            // root depends on parent, as much as index
            this._triggerPropertyChange(['parent', 'root']);
        }
      , get: function(){ return this._parent; }
    });

    /**
     * This method is only called by the node and the parent node and
     * has no effect if index did not change for real!
     */
    _p.updateIndex = function() {
        var index = this._parent
                ? this._parent.find(this)
                : false
                ;
        if(index === this._index)
            return;

        this._indexPath = null;
        this._masterIndexPath = null;
        this._index = index === false ? null : index;

        this._triggerPropertyChange('index');
    };

    _p.remove = function(item) {
        var i, l, root, child;
        if(Object.isFrozen(this._children))
            throw new OMAError('Removing children is not allowed in this element.');

        i = this.find(item)
        if(i === false)
            throw new OMAError([this, 'can\'t remove', item ,'because',
                                'it is not a child.'].join(' '));
        this._childrenIndexes.delete(item);
        this._children.splice(i, 1);
        for(l=this._children.length;i<l;i++) {
            // All children from i need now a new index!
            child = this._children[i];
            this._childrenIndexes.set(child, i);
            child.updateIndex();
        }
        // a generic splice api would be good
        item.parent = null;
        // FIXME: if different, the key that is triggeracceped here should be
        // a reverse lookup of _cps_whitelist. i.e. the key within this
        // _Node is the value in _cps_whitelist.
        // in this case, there is no need to reverse.
        root = this.root;
        if(root)
            // must also clean all children
            root.removeFromTree(item);
        this._triggerPropertyChange('children');
        return true;
    };

    _p.add = function(item) {
        if(Object.isFrozen(this._children))
            throw new OMAError('Adding children is not allowed in this element.');
        if(!this.qualifiesAsChild(item))
            throw new OMAError([this, 'doesn\'t accept', item
                                        , 'as a child object.'].join(' '));
        if(item.parent !== null)
            item.parent.remove(item);
        this._childrenIndexes.set(item, this._children.length);
        this._children.push(item);
        item.parent = this;
        this._triggerPropertyChange('children');
    };

    _p.query = function(selector) {
        return this.root.query(selector, this);
    };

    _p.queryAll = function(selector) {
        return this.root.queryAll(selector, this);
    };

    _p.getComputedStyle = function() {
        return this.root.getComputedStyleFor(this);
    };

    _p._triggerCpsChange = function(){
       clearTimeout(this._cpsChange.timeoutId);
       var eventData = this._cpsChange.eventData;
       this._cpsChange.timeoutId = null;
       this._cpsChange.eventData = [];
       this._trigger('CPS-change', eventData);
    };

    _p._cpsChangeHandler = function(subscriberData, channelKey, eventData) {
        // The styledicts are already debounced so that they fire only
        // once after all sync tasks are done. Debouncing here could still
        // be useful to create less events, however, the subscriber will
        // have to debounce as well. Maybe, we could try to shift the
        // StyleDict debouncing to here then also changes of this item's
        // children will be held back (but they do the same, so a propper
        // waiting time for 10 ms in the subscriber is maybe best)
        if(eventData)
            this._cpsChange.eventData.push(eventData);
        if(this._cpsChange.timeoutId)
            return;
            // Now an event is scheduled, so there's no need for a further
            // action. In the future, we may pass a promise around to trigger
            // when the current task has finished. Similar considerations
            // are in StyleDict.js at Styledict.prototype._nextTrigger
            //clearTimeout(this._cpsChange.timeoutId);
        this._cpsChange.timeoutId = setTimeout(this._cpsChange.trigger, 0);
    };

    /**
     * When there is a listener for CPS-change the first time, this will
     * subscribe to all it's children and to its computedStyle to get the
     * message. The children will subscribe themselve to all their children.
     *
     * NOTE: currently we only register changes from StyleDict, that means
     * the CPS model, we don't know about changes in the OMA.
     *
     * FIXME! we need to "clean up" subscriptions when an element looses
     * root (i.e. is removed from parent).
     */
    _p._initCPSChangeEvent = function() {
        var callback
          , changeSubscriptions = this._changeSubscriptions
          , style
          , children, i, l, child
          ;
        if(changeSubscriptions === null) {
            // only if this is the first subscription:
            changeSubscriptions = this._changeSubscriptions = Object.create(null);
            Object.defineProperty(changeSubscriptions, 'counter', {
                value: 0
              , writable: true
              , enumerable: false
            });

            callback = [this, '_cpsChangeHandler'];
            style = this.getComputedStyle();
            // FIXME: do I wan't this to hold an actual reference to its
            // StyleDict??? this was managed solely by models/Controller previously.
            // At least it should drop the dependency when it is disconnected from
            // root.
            changeSubscriptions._styleDict_ = [style, style.on('change', callback)];
            children = this._children;
            for(i=0,l=children.length;i<l;i++) {
                child = children[i];
                changeSubscriptions[child.nodeID] = [child, child.on('CPS-change', callback)];
            }
        }
        changeSubscriptions.counter += 1;
    };

    _p._deinitCPSChangeEvent = function(subscriberID) {
        var k, subscription
          , changeSubscriptions = this._changeSubscriptions
          ;
        if(!changeSubscriptions)
            return;
        changeSubscriptions.counter -= 1;
        if(changeSubscriptions.counter === 0) {
            delete changeSubscriptions._styleDict_;
            for(k in changeSubscriptions) {
                subscription = changeSubscriptions[k];
                subscription[0].off(subscription[1]);
            }
        }
        this._changeSubscriptions = null;
    };

    /**
     * Use "CPS-change" this as an indicator to schedule a redraw;
     */
    _p.on = function(channel, subscriberCallback, subscriberData) {
        // TODO: a beforeOnHook('change', method) would be nice here
        // See also the comment in _p.off
        var i,l;
        if(channel instanceof Array) {
            for(i=0,l=channel.length;i<l;i++)
                if(channel[i] === 'CPS-change') {
                    this._initCPSChangeEvent();
                    break;
                }
        }
        else if(channel === 'CPS-change')
            this._initCPSChangeEvent();

        return this._on(channel, subscriberCallback, subscriberData);
    };

    _p.off = function(subscriberID) {
        // will raise if not subscribed, so it happen before _deinitChangeEvent
        var result = this._off(subscriberID), i,l;
        // TODO: this requires knowledge of the structure of emitterMixin
        // subscriberIDs! That is a bit unfortunate.
        // A solution would be a afterOffHook('change', method) here.
        // I consider that overengineering for the moment.
        if(subscriberID[0] instanceof Array)
            for(i=0,l=subscriberID.length;i<l;i++)
                if(subscriberID[i] === 'CPS-change') {
                    this._deinitCPSChangeEvent();
                    break;
                }
        else if(subscriberID[0] === 'CPS-change')
            this._deinitCPSChangeEvent();

        return result;// usually undefined
    };

    // FIXME: I'd prefer the bloomfilter stuff within
    // SelectorEngine. Using probably a central WeakMap
    // and an event when the bloomfilter needs to be
    // pruned. _getBloomFilterData could stay a part
    // of _Node tough??? we'll, it's tighly connected
    // to the selectors, so no, can all be in selector
    // engine. It could become a dependency injected
    // bundle there, if more tuning is needed!
    // All of these data-fields are public APIs anyways
    // so, a event is needed if one of the bloom filter
    // data fields changes.
    _p._getBloomFilterData = function() {
        var data
          , parts, id, k
          , classes
          ;
        data = [this.type];

        id = this.id;
        if(id)
            data.push('#' + id);

        classes = this._classes;
        for(k in classes)
            data.push('.' + k);

        return data;
    };

    _p.getBloomFilter = function() {
        var bf = this._bloomFilter
          , data,i,l
          ;
        if(!bf) {
            // we cache this but we will have to invalidate on many occasions
            // Changes in the parent tree, as well as changes of this nodes
            // id and classes
            // A cache also speeds up the creation of the filter, because we
            // can just do: this.parent.getBloomFilter().clone()
            // and the add this nodes signature

            if(this.parent)
                bf = this.parent.getBloomFilter().clone();
            else
                // I think we don't need a particular big filter
                // This must be the same as in SelectorEngine (Constructor)
                // FIXME: put this in a shared module, so that the
                // synchronization of this setup is explicit!
                bf = new bloomfilter.BloomFilter(512, 5);

            this._bloomFilter = bf;
            data = this._getBloomFilterData();
            for(i=0,l=data.length;i<l;i++)
                bf.add(data[i]);
        }
        return bf;
    };

    return _Node;
});
