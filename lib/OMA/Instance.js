define([
    'Atem-CPS/errors'
  ,  'Atem-CPS-whitelisting/whitelisting'
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
    // jshint esnext:true, newcap:false
    /*global clearTimeout, setTimeout, Symbol*/

    const OMAError = errors.OMA
      , NotImplementedError = errors.NotImplemented
      , DeprecatedError = errors.Deprecated
      , assert = errors.assert
      , OMAIdError = errors.OMAId
      , ReceiverError = errors.Receiver
      , ValueError = errors.Value
      , getUniqueID = (function() {
            var _id_counter = 0;
            function getUniqueID() {
                return _id_counter++;
            }
            return getUniqueID;
        })()
      , emitterMixinSetup = {
              stateProperty: '_channel'
            , onAPI: '_on'
            , offAPI: '_off'
            , triggerAPI: '_trigger'
        }
      , propertyChangeEmitterSetup = {
              stateProperty: '_dependants'
            , onAPI: 'onPropertyChange'
            , offAPI: 'offPropertyChange'
            , triggerAPI: '_triggerPropertyChange'
        }
      ;

    /**
    Todo;crisscrosscheck with _Node;
        looking good:
            serialization will be a big task
    Todo;InstanceData;
    Todo;get bootstrapping/root/root-apis straight;
    Todo;make baseInstances work, also, are these part of InstanceData?
    Todo: make fork,translate,merge actions work!
     */
    function Instance(pattern, parent/*, data ??? */) {
        Object.defineProperty(this, 'nodeID', {value: getUniqueID()});
        Object.defineProperty(this, 'parent', {value: parent});
        Object.defineProperty(this, 'root', {
            value: this.isRoot() ? this : this.parent.root
        });

        // An instance is constituted by it's edge in the pattern
        // tree the edge is from: this.parent.pattern to this.pattern
        // the instances index in parent must be the same index as
        // the according index of this.pattern in this.parent.pattern.children.
        // It is also depending on the parent instances in the instance tree
        // i.e. if a pattern is used many times, each edge to it's children
        // will constitute many instances.
        this.pattern = null;
        this._patternUnsubscribe = null;

        this._children = [];
        // NOTE: this has *not* the same implications as Object.freeze in a OMANode
        // here, it is just for not having to use defensive copying in the
        // children getter.
        Object.freeze(this._children);

        this._childrenData = new Map();

        this._ids = this.idManager ? Object.create(null) : null;

        this._index = null;
        this._tailIndex = null; // index from the end, needed for cache invalidation
        this._indexPaths = Object.create(null);

        // START InstanceData
        this._attachedData = null;
        this._id = null;
        this._classes = Object.create(null);
        // this has higher precedence than any rule loaded by CPS
        // and it is unique to this Instance.
        // DOM Elements have element.style, this is analogous
        Object.defineProperty(this, 'properties', {
            value: new PropertyDict([], '*element properties*')
          , enumerable: true
        });
        // END InstanceData

        // FIXME: Will go into SelectorEngine
        this._bloomFilter = null;

        this._changeSubscriptions = null;
        emitterMixin.init(this, emitterMixinSetup);
        emitterMixin.init(this, propertyChangeEmitterSetup);
        // timeout ... do we want this to be async?
        this._cpsChange = {
            timeoutId: null
          , eventData: []
          , trigger: this._triggerCpsChange.bind(this)
        };

        // set pattern
        // TODO: re-setting will be added later, once this is done
        this._pattern = pattern;
        this._patternUnsubscribe = this._pattern.on(['inserted', 'removed'],
                                    [this, 'essenceChangeHandler']);
        this._instanciateChildren(0, this.pattern.childrenLength);
    }

    var _p = Instance.prototype;
    _p.constructor = Instance;

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
     *
     * "subtree" and "essence" may never be an actual property, they are used
     * as a virtual properties via the onPropertyChange channel.
     *
     * "subtree" includes changes on children "essence", "id" "classes" and
     * "subtree" properties.
     *
     * "essence" is just the children OMA-structure
     */
    _p._cps_whitelist = {
        parent: 'parent'
      , children: 'children'
      , root: 'root'
      , index: 'index'
      , id: 'id'
      , type: 'type'
      , baseNode: 'baseNode'
    };

    _p.cpsGet = whitelisting.getMethod;
    _p.cpsHas = whitelisting.hasMethod;

    _p._getValidator = function(key) {
        return this._pattern.getValidator(key);
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

    _p._dumpClasses = function() {
        var k;
        for(k in this._classes)
            // we have classes
            return this.classes;
        return null;
    };

    _p._loadClasses = function(classes) {
        // do only if necessary and in a way that the 'classes' event
        // is triggered just once.
        var seen = new Set(), i, l, name;
        for(i=0,l=classes.length;i<l;i++) {
            // check if there are new class names
            name = classes[i];
            seen.add(name);
            if(!(name in this._classes)) {
                // at least one new name; mark for reset:
                this._classes = null;
                break;
            }
        }
        if(this._classes !== null) {
            for(name in this._classes)
                // check if there are superfluous class names
                if(!seen.has(name)) {
                    // mark for reset
                    this._classes = null;
                    break;
                }
        }
        if(this._classes === null) {
            // reset
            this._classes = Object.create(null);
            this.setClasses(classes);
        }
    };

    _p._dumpProperties = function(simpleProperties) {
        var properties, result = null, i, l, k, keys, items;
        if(simpleProperties) {
            // Do a key: value serialization, looses double key entries
            // but is easier to read and write for humans
            properties = Object.create(null);
            keys =  this.properties.keys();
            for(i=0,l=keys.length;i<l;i++) {
                k = keys[i];
                properties[k] = this.properties.get(k).toString();
            }
            if(l)
                result = properties;
        }
        else {
            // Put each [key, value] pair as a list into a list.
            // This preserves all information of the PropertyDict, but
            // it's harder to read/modify for some humans, because there
            // are more brackets and such.
            properties = [];
            items = this.properties.items;
            for(i=0,l=items.length;i<l;i++)
                properties.push([items[i].name, items[i].value.toString()]);
            if(l)
                result = properties;
        }
        return result;
    };

    _p._loadProperties = function(makeProperty, properties) {
        // TODO: similar to _loadClasses, this should only trigger a change
        // event if necessary. I keep this for another iteration.
        // Should maybe be implemented in the PropertyDict.
        var newProperties = []
          , k, i, l
          ;
        if(!(properties instanceof Array))
            // used simpleProperties=true in
            for(k in properties)
                newProperties.push(makeProperty(k, properties[k]));
        else
            for(i=0,l=properties.length;i<l;i++)
                newProperties.push(makeProperty(properties[i][0], properties[i][1]));
        this.properties.splice(0, this.properties.length, newProperties);
    };

    _p._dumpAttachment = function() {
        var k;
        if(this._attachedData)
            // check if there is at least one key in this._attachedData prior
            // to setting it. Hence 'for(k in ...) do(); break;' instead of just
            // 'if(this._attachedData) do();'
            for(k in this._attachedData)
                // In _loadAttachment we do the same "deep clone"
                // But here we do it so that the returned data doesn't
                // change when this._attachedData changes.
                return JSON.parse(JSON.stringify(this._attachedData));
        return null;
    };

    _p._loadAttachment = function(attachment) {
        // This is a bit paranoid: serialize then deserialize
        // (poor mans deep clone ...) to break unwanted shared references
        // to attachment with other users of it. Otherwise, using
        // this.attachData(attachment) would do the thing just fine.
        this.attachData(JSON.parse(JSON.stringify(attachment)));
    };

    /**
     * Returns an object if there is any data to be serialized, otherwise null.
     *
     * The object is meant to be consumed by loadData and must be de-/serializable
     * by methods like JSON.stringify or yaml.safeDump without loss.
     *
     * dumpFlags: A bitmask (integer number) with the flags:
     *      dumpId           =    1
     *      dumpClasses      =    2
     *      dumpProperties   =    4
     *      dumpAttachedData =    8
     * default: dump all
     */
    _p.dumpData = function(simpleProperties, dumpFlags) {
        var result = Object.create(null)
          , data, k
          , flags = dumpFlags === undefined
                ? (1|2|4|8)//all
                : dumpFlags
          , dumpId = flags & 1
          , dumpClasses = flags & 2
          , dumpProperties = flags & 4
          , dumpAttachedData = flags & 8
          ;

        if(dumpId && this._id)
            result.id = this._id;

        if(dumpClasses) {
            data = this._dumpClasses();
            if(data)
                result.classes = data;
        }

        if(dumpProperties) {
            data = this._dumpProperties(simpleProperties);
            if(data)
                result.properties = data;
        }

        if(dumpAttachedData) {
            data = this._dumpAttachment();
            if(data)
                result.attachment = data;
        }

        for(k in result)
            // only return result if there is any content
            return result;
        return null;
    };

    _p._loadData = function(makeProperty, data) {
        // FIXME: delay StyleDict invalidation (note: until when?)
        if('id' in data)
            this.id = data.id;

        if('classes' in data)
            this._loadClasses(data.classes);

        if('properties' in data)
            this._loadProperties(makeProperty, data.properties);

        if('attachment' in data)
            this._loadAttachment(data.attachment);
    };

    _p.walkTreeDepthFirst = function(callback) {
        var i,l;
        callback(this);
        for(i=0,l=this._children.length;i<l;i++)
            this._children[i].walkTreeDepthFirst(callback);
    };

    /**
     * Attach custom data to the node.
     * When called with just one argument, a typeof 'object' the internal
     * object is replaced.
     * Otherwise two arguments: key, value are expected and written to
     * the internal object.
     *
     * This data can be anything but it should survive serialization
     * to JSON and YAML. The data won't be available to CPS and
     * not trigger any events on change (that could be changed).
     * ES6 Proxies may be an option to patch the observation yourself.
     * As of Feb 2015 they are in Firefox and Chrome/V8.
     *
     * Returns undefined.
     */
    _p.attachData = function(key, value) {
        if(arguments.length === 1 && typeof key === 'object') {
            this._attachedData = key;
            return;
        }
        if(!this._attachedData)
            this._attachedData = Object.create(null);
        this._attachedData[key] = value;
    };
    /**
     * When called without arguments, the internal object is deleted.
     * When called with one argument "key" the entry at key
     * of the internal object is deleted.
     *
     * Returns undefined.
     */
    _p.detachData = function(key) {
        if(arguments.length === 0)
            this._attachedData = null;
        else if(this._attachedData)
            delete this._attachedData[key];
    };
    /**
     * When called without arguments the internal object is returned.
     * When called with one argument "key" the value at key
     * of the internal object is returned.
     */
    _p.getAttachment = function(key, searchInBaseNodeChain) {
        if(arguments.length === 0)
            return this._attachedData;
        if(this._attachedData && key in this._attachedData)
            return this._attachedData[key];
        FIXME; if(searchInBaseNodeChain && this._baseNode)
         return this._baseNode.getAttachment(key, searchInBaseNodeChain);
    };

    Object.defineProperty(_p, 'pattern', {
       get: function(){return this._pattern;}
      , enumerable: true
    });

    _p.essenceChangeHandler = function(ownData, channelKey, eventData) {
        switch(channelKey) {
            case 'inserted':
                this._instanciateChildren(eventData[0], eventData[1]);
                break;
            case 'removed':

                this._splice(eventData[0], eventData[1]);
                break;
            default:
                throw new ReceiverError('Unknown channelKey: '+channelKey);
        }
    };

    /**
     * "essence" and "subtree" are originally fired next to each other,
     * so this function is usually called twice for the same event, once
     * with  channelKey === "essence" and then immediateley with
     * channelKey === "subtree" also in here channelKey can be "id"
     * and "classes" for each of the children of this node.
     * "essence" triggers only "essence".
     * "subtree", "id" and "classes" trigger "subtree"; so "subtree"
     * accumulates.
     * If "essence" is channelKey here we don't need to fire "subtree"
     * because it will be followed by a call to this with  "subtree".
     */
    _p._childEventRealaisHandler = function(subscriberData, channelKey, eventData) {
        /* jshint unused:vars */
        var outChannel = channelKey === 'essence'
            ? 'essence'
            : 'subtree'
            ;
        this._triggerPropertyChange(outChannel);
    };


    // previously a node could be removed from the tree and then
    // attached to another node, so this is where lostRoot/gainedRoot
    // comes into play.
    // I think we don't have this anymore! when an instance is removed
    // it's destroyed permanently, because root is the source of
    // all instances and without root the instance ceases to exist.
    // However, we can evacuate it's data and move it around.
    // fork,merge,transport
    // fork: a pattern is cloned, same structure new identity
    //
    // merge: two patterns are identical (like after fork) and is replaced
    //        by the other, taking over all of its instances
    //
    // translate: InstanceData is moved between compatible instances
    //           >> make instanceData immutable or copy on write!
    _p.destroy = function() {
        var i, l;
        assert(!this.parent.find(this), this + ' must not be registered '
                                             + 'anymore in its parent.');
        this._unsubscribeFromStyleChange(this);
        for(i=0,l=this._children.length;i<l;i++)
            this._children[i].destroy();
        // FIXME: do we need to emit an event like "destroy" here?
        // parent does emit something, already
    };

    _p._deleteChild = function (item) {
        var data = this._childrenData.get(item)
          , off = data[1] // off function
          ;
        this._childrenData.delete(item);
        off();
        this.removeSubtreeIds(item);
        this.root.removeFromTree(item); // good???
        this._unsubscribeFromStyleChange(item);
        item.destroy();
    };

    _p._registerChild = function(idx, item) {
        // property changes in ['subtree', 'id', 'classes', 'essence']
        // trigger themselves a property change event for in this node.
        // i.e. they bubble upwards
        var off = item.onPropertyChange(['essence', 'subtree', 'id', 'classes']
                                , [this, '_childEventRealaisHandler']);
        // see/compare/DRY also `_instanciateChild`
        this._childrenData.set(item, [idx, off]);
        // item can now call this.parent.find(this), thus:
        item.updateIndex();
        this.addSubtreeIds(item);
        // only subscribes if there are receivers (this._changeSubscriptions)
        this._subscribeToStyleChange(item);
    };

    // no longer public, essence must be changed via node
    // we'll need some convenience methods though, but these will probably
    // be higher level
    _p._splice = function(startIndex, deleteCount, _insertions /* single item or array of items */) {
        var insertions = _insertions instanceof Array
                ? _insertions
                : (_insertions
                        ? []
                        : [_insertions]
                  )
          , deleted, args, i, l, item, idx
          , insertionsEndIndex, delta, indexChanged
          ;

        // PERFORM
        args = [startIndex, deleteCount];
        Array.prototype.push.apply(args, insertions);

        this._children = this._children.slice(); // copy on write
        deleted = Array.prototype.splice.apply(this._children, args);
        Object.freeze(this._children); // immutable

        // CLEANUP DELETIONS
        for(i=0,l=deleted.length;i<l;i++)
            this._deleteChild(deleted[i]);

        // REGISTER INSERTIONS
        for(i=0,l=insertions.length;i<l;i++) {
            item = insertions[i];
            idx = startIndex + i;
            this._registerChild(idx, item);
        }

        delta = insertions.length - deleted.length;
        insertionsEndIndex = startIndex + insertions.length;
        for(i=0,l=this._children.length;i<l;i++) {
            item = this._children[i];
            if(i>=startIndex && i<insertionsEndIndex)
                // we just covered that in the insertions loop.
                continue;
            indexChanged = (item.index !== i);
            if(indexChanged)
                // update index
                this._childrenData.get(item)[0] = i;

            if(delta || indexChanged)
                // if delta: tailIndex changed for all
                item.updateIndex();
        }

        if(deleted.length || insertions.length)
            this._triggerPropertyChange(['children', 'essence', 'subtree']);
        return deleted;
    };


    Object.defineProperty(_p, 'children', {
        /**
         * Returns this._children, which is frozen, so we can't mess around
         * with the internal list of children.
         */
        get: function(){ return this._children; }
    });

    Object.defineProperty(_p, 'childrenLength', {
        /**
         * Convenience for calling node.children.length.
         */
        get: function(){ return this._children.length; }
    });

    _p.getChild = function(index) {
        return this._children[index];
    };

    _p.find = function(item) {
        var data = this._childrenData.get(item);
        return data === undefined ? false : data[0];
    };

    Object.defineProperty(_p, 'index', {
        get: function(){ return this._index;}
    });

    Object.defineProperty(_p, 'type', {
        get: function() {
            return this.pattern.type;
        }
    });
    /**
     *  This is used to have an address for the serialization of the
     * _Node.properties (an probably other data). For some applications
     * it may be OK to use unique #ids instead of indexes. I.e. When
     * serializing a master in metapolator its glyph could be indexed by
     * names, and thus make it easier to inspect such a serialization by
     * looking at the file.
     * However, it's not the most important part of this to be human readable.
     * But it could become the second most important part!
     * Maybe The data that is serialized can contain a hint about its origin.
     * Using YAML it may be possible to add a comment (after all, comments
     * are the one reason why I prefer YAML over JSON).
     */
    _p.getIndexPath = function(stopNode) {
        // if there is no stopNode the cache address is an empty string
        var key = stopNode && stopNode.nodeID || this.root.nodeID
          , indexPath = this._indexPaths[key]
          , parentIndexPath
          ;
        if(!indexPath) {
            if(this === stopNode)
                // if this.isRoot() we still return a relative path
                indexPath = '.';
            else if(this.isRoot())
                // `if stopNode`: this it indicates that root was arrived
                // before stopNode was encountered.
                // `/` makes this an "absolute" path, analogous to how a
                // filesystem path would look like.
                indexPath = '/';
            else {
                parentIndexPath = this.parent.getIndexPath(stopNode);
                indexPath = [parentIndexPath, this._index]
                                // don't make an absolute path that starts
                                // with two slashes
                                .join(parentIndexPath !== '/' ? '/' : '');
            }
            this._indexPaths[key] = indexPath;
        }
        return indexPath;
    };

    ///////////////
    // -> START IDS
    ///////////////
    /**
     * Is set by pattern. Make overrideable?
     */
    Object.defineProperty(_p, 'idManager', {
        get: function() {
            // If this is a root it must be idManager as well:
            return this.isRoot() || this.pattern.idManager;
        }
    });

   _p.requestSetId = function(descendant, id) {
        if(!this.idManager)
            // this moves to root if no Node on the way is an idManager.
            return this.parent.requestSetId(descendant, id);

        if(descendant.getIdManager() !== this)
            return false;
        // this node is responsible
        return this._setDescendantId(descendant, id);
    };

    /**
     * used only if this is an idManager
     */
    _p._setDescendantId = function(descendant, id, newNode) {
        var registered = this._ids[id];
        if(registered)
            throw new OMAIdError('Id "' + id + '" is already taken by: '
                                        + registered + ' ' + registered.particulars);
        if(descendant.id) {
            if(!newNode)
                // When the descendant has an id and is then added to a subtree
                // controlled by this idManager, then the descendant id is not
                // yet registered here.
                assert(this._ids[descendant.id] === descendant, 'The nodes '
                                        + 'id should be registered here.');
            if(this._ids[descendant.id] === descendant)
                delete this._ids[descendant.id];
        }

        if(id !== null) {
            this._ids[id] = descendant;
            descendant.updateId(id);
        }
        return true;
    };

    _p.removeSubtreeIds = function(descendant) {
        if(!this.idManager)
            // this moves to root if no Node on the way is an idManager.
            return this.parent.removeSubtreeIds(descendant);
        var nodes = [descendant], node;
        while((node=nodes.pop())) {
            if(node.id && this._ids[node.id] === node
                       && node.getIdManager() !== this)
                delete this._ids[descendant.id];
            if(!node.idManager)
                Array.prototype.push.apply(nodes, node.children);
        }
    };

    _p.addSubtreeIds = function(descendant) {
        if(!this.idManager)
            // this moves to root if no Node on the way is an idManager.
            return this.parent.addSubtreeIds(descendant);
        if(descendant.getIdManager() !== this)
            return false;
        var nodes = [descendant], node;
        while((node=nodes.pop())) {
            if(node.id)
                // FIXME: Here we could handle collisions (OMAIdError) gracefully.
                this._setDescendantId(node, node.id, true);
            // if node is not an idManager this is responsible.
            if(!node.idManager)
                // this results in a breadth first traversal
                Array.prototype.unshift.apply(nodes, node.children.reverse());
        }
    };

    _p.getById = function(id) {
        if(!this.idManager)
            // this moves to root if no Node on the way is an idManager.
            return this.parent.getById(id);
        return this._ids[id];
    };

    _p.getIdManager = function() {
        var parent = this.parent;
        while(parent) {
            if(parent.idManager)
                return parent;
            parent = parent.parent;
        }
        throw new OMAError('Can\t find an idManager for '+ this);
    };

    // don't use this directly ever, it's just here for DRY in
    // updateId and the _p.id setter
    function _setId(id) {
        //jshint validthis:true
        if(id !== this.id) {
            this._bloomFilter = null;
            this._id = id || null;
            this._triggerPropertyChange('id');
        }
    }

    _p.updateId = function(id) {
        var node = this.parent.getById(id);
        if (node === this)
            _setId.call(this, id);
    };

    Object.defineProperty(_p, 'id', {
        /**
         * The Mechanism how id's are verified etc. need to be defined,
         * probably on a per OMA-Element base. And probably always the
         * parent is responsible for id checking and setting. At the
         * moment, I need id's to write the selector engine, and for that,
         * I don't need properly checked IDs
         */
        set: function(id) {
            // will call updateId on success
            var managed = this.parent.requestSetId(this, id);
            // FIXME: not sure why managed should be false, investigate!
            if(!managed || id === null)
                _setId.call(this, id);
        }
      , get: function(){ return this._id; }
    });

    /////////////
    // <- END IDS
    /////////////

    _p.isRoot = function() {
        // maybe defined differently
        // e.g. return this.parent === null
        return this.pattern.isRoot();
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

    _p._triggerCpsChange = function() {
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
            // FIXME: not sure if I should throttle or debounce here
            // OR nothing and let an upper level decide.
            // A similar situation is with the "change" event in StyleDict
            // clearTimeout here is "debouncing"
            // return here is "throttling"
            clearTimeout(this._cpsChange.timeoutId);
            //return;

            // Now an event is scheduled, so there's no need for a further
            // action. In the future, we may pass a promise around to trigger
            // when the current task has finished. Similar considerations
            // are in StyleDict.js at Styledict.prototype._nextTrigger
            //clearTimeout(this._cpsChange.timeoutId);
        this._cpsChange.timeoutId = setTimeout(this._cpsChange.trigger, 0);
    };

    // annoying UI-related function to break redraw loops caused by
    // ui input elements (initially needed in BEF).
    //
    // If there are more listeners attached than the one feedback creating
    // interface, it is better to unsubscribe while the feedback is
    // generated and to subscribe after again. But, with only one consumer
    // unsubscribing/resubscribing can be more expensive: a lot
    // of internal subscriptions are canceled when there are no subscribers
    // anymore.
    // Maybe, the feedback creating interface could also just deafen its listener.
    _p.flushStyleChanges = function() {
        var i, l;
        if(this._cpsChange.timeoutId)
            clearTimeout(this._cpsChange.timeoutId);
        this._cpsChange.timeoutId = null;
        this._cpsChange.eventData = [];
        for(i=0,l=this._children.length;i<l;i++)
            this._children[i].flushStyleChanges();
    };

    _p._unsubscribeFromStyleChange = function(item) {
        var changeSubscriptions = this._changeSubscriptions
          , off, k
          ;
        if(!changeSubscriptions)
            return;
        if(!item) {
            // without item remove all subscriptions
            for(k in changeSubscriptions) {
                off = changeSubscriptions[k];
                off();
                delete changeSubscriptions[k];
            }
        }
        else {
            k = item === this ? '_styleDict_' : item.nodeID;
            off = changeSubscriptions[k];
            if(off) {
                off();
                delete changeSubscriptions[k];
            }
            // else: not subscribed, should we fail here?
        }
    };

    _p._subscribeToStyleChange = function(item) {
        var changeSubscriptions = this._changeSubscriptions
          , callback
          , style
          , k, off
          ;
        if(!changeSubscriptions)
            return;
        // TODO: that callback array could be a fixed property of this.
        callback = [this, '_cpsChangeHandler'];
        k = item === this ? '_styleDict_' : item.nodeID;
        if(k in changeSubscriptions)
            // already subscribed, should we fail here?
            return;
        if(item === this) {
            // If this node loses root. We must handle that.
            style = this.getComputedStyle();
            off = style.on('change', callback);
        } else
            off = item.on('CPS-change', callback);
        changeSubscriptions[k] = off;
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
        var changeSubscriptions = this._changeSubscriptions
          , children, i, l
          ;
        if(changeSubscriptions === null) {
            // only if this is the first subscription:
            changeSubscriptions = this._changeSubscriptions = Object.create(null);
            Object.defineProperty(changeSubscriptions, 'counter', {
                value: 0
              , writable: true
              , enumerable: false
            });
            this._subscribeToStyleChange(this);
            children = this._children;
            for(i=0,l=children.length;i<l;i++)
                this._subscribeToStyleChange(children[i]);
        }
        changeSubscriptions.counter += 1;
    };

    _p._deinitCPSChangeEvent = function() {
        //jshint unused:false
        var k, subscription
          , changeSubscriptions = this._changeSubscriptions
          ;
        if(!changeSubscriptions)
            return;
        changeSubscriptions.counter -= 1;
        if(changeSubscriptions.counter === 0)
            this._unsubscribeFromStyleChange();
        this._changeSubscriptions = null;
    };

    /**
     * Use "CPS-change" this as an indicator to schedule a redraw;
     */
    _p.on = function(channel, subscriberCallback, subscriberData) {
        // TODO: a beforeOnHook('change', method) would be nice here
        // See also the comment in _p.off
        var i,l, off;
        if(channel instanceof Array) {
            for(i=0,l=channel.length;i<l;i++)
                if(channel[i] === 'CPS-change') {
                    this._initCPSChangeEvent();
                    break;
                }
        }
        else if(channel === 'CPS-change')
            this._initCPSChangeEvent();

        off = this.off.bind(this
                , this._on(channel, subscriberCallback, subscriberData));
        Object.defineProperty(off, '$creator', {value: this});
        return off;
    };

    _p.off = function(off) {
        if(off.$creator === this) {
            console.trace();
            console.warn(new DeprecatedError('Please use the unsubscribe '
                                + 'function returned by `on` directly'));
            return off();
        }
        // will raise if not subscribed, so it happen before _deinitChangeEvent
        var result = off(), i,l
          // FIXME: this usage is rather ugly and hard to read!
          // subscriberID should be an internal of emitterMixin only,
          // not "extended" for use in here.
          , subscriberID = off.subscriberID
          ;
        // TODO: this requires knowledge of the structure of emitterMixin
        // subscriberIDs! That is a bit unfortunate.
        // A solution would be a afterOffHook('change', method) here.
        // I consider that overengineering for the moment.
        if(subscriberID[0] instanceof Array)
            for(i=0,l=subscriberID.length;i<l;i++)
                if(subscriberID[i][0] === 'CPS-change') {
                    this._deinitCPSChangeEvent();
                    break;
                }
        else if(subscriberID[0] === 'CPS-change')
            this._deinitCPSChangeEvent();

        return result;// usually undefined
    };

    /**
     * FIXME: I was always not too happy with this in MOM, for
     *        no particular reason. Maybe it can  be changed a bit.
     *        It's used a lot in MOM, so analyzing for what cases
     *        it's used woud be a good start,
     *
     *
     * returns a selector for this element, currently it is used for
     * display purposes, so the additional information "(no parent) "
     * is prepended if the item has no parent (only root?!)
     * The selector is valid and selects only this element.
     */
    Object.defineProperty(_p, 'particulars', {
        get: function() {
            return [
                    this.parent ? this.parent.particulars : '(no parent)'
                  , ' '
                  , this.type
                  , (this.id ? '#' + this.id : '')
                  , (this.parent
                        ? ':i(' + this.index + ')'
                        : '')
                ].join('');
        }
    });

    _p._setCLass = function(name) {
        if(name !== '' && !(name in this._classes)) {
            this._bloomFilter = null;
            this._classes[name] = null;
            return true;
        }
        return false;
    };

    var _cache = Symbol('cache');

    _p.setClass = function(name) {
        if(this._setCLass(name)) {
            delete this._classes[_cache];
            this._triggerPropertyChange('classes');
        }
    };

    _p.setClasses = function(classes) {
        var i, l, changed = false;
        for(i=0,l=classes.length;i<l;i++) {
            changed = this._setCLass(classes[i]) || changed;
        }
        if(changed) {
            delete this._classes[_cache];
            this._triggerPropertyChange('classes');
        }
    };

    _p.removeClass = function(name) {
        if(name in this._classes[name]) {
            this._bloomFilter = null;
            delete this._classes[name];
            delete this._classes[_cache];
            this._triggerPropertyChange('classes');
        }
    };

    _p.hasClass = function(name) {
        return name in this._classes;
    };

    Object.defineProperty(_p, 'classes', {
        get: function() {
            if(!(_cache in this._classes[_cache])) {
                this._classes[_cache] = Object.keys(this._classes);
                Object.freeze(this._classes[_cache]);
            }
            return this._classes[_cache];
        }
      , enumerable: true
    });

    _p.toString = function() { return ['<', this.type, ' ', this.nodeID, '>'].join('');};

    _p._instanciateChild = function(idx) {
        var pattern = this.pattern.getChild(idx);
        return new Instance(pattern, this);
    };

    _p._instanciateChildren = function(startIndex, amount) {
        var i, idx, instances = [];
        for(i=0;i<amount;i++) {
            idx = startIndex + i;
            instances.push(this._instanciateChild(idx));
        }
        this._splice(startIndex, 0, instances);
    };

    /**
     * This method is only called by the node and the parent node and
     * has no effect if index did not change for real!
     */
    _p.updateIndex = function() {
        var index = this.parent // if there is a parent, there is an index.
                    ? this.parent.find(this)
                    : null
          , tailIndex = index !== null
                    ? this.parent.childrenLength - index - 1
                    : null
          , changed = []
          ;

        if(index !== this._index) {
            this._index = index;
            this._indexPaths = Object.create(null);
            changed.push('index');
        }

        if(tailIndex !== this._tailIndex) {
            this._tailIndex = tailIndex;
            changed.push('tail-index');
        }

        if(changed.length)
            this._triggerPropertyChange(changed);
    };

    /**
     * Need to get `cpsTools.makeProperty` from somewhere!
     *
     * Implement this like so:
     *
     * ```
     * _p.loadData = function(data) {
     *     this._loadData(cpsTools.makeProperty, data);
     * }
     * ```
     *
     * NOTE: cpsTools.makeProperty is dependent on the actual setup of
     * your object model. That's why it is not defined in here.
     */
    _p.loadData = function(data) {
        // jshint unused:vars
        throw new NotImplementedError('A subclass must implement loadData');
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
    // so, an event is needed if one of the bloom filter
    // data fields changes.
    _p._getBloomFilterData = function() {
        var data
          , id, k
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

    return Instance;

});
