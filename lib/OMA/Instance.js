define([
    'Atem-CPS/errors'
  , 'Atem-CPS-whitelisting/whitelisting'
  , 'Atem-CPS/emitterMixin'
  , 'Atem-CPS/OMA/InstanceData'
  , 'Atem-CPS/OMA/RootAPI'
  , 'bloomfilter'
], function(
    errors
  , whitelisting
  , emitterMixin
  , InstanceData
  , RootAPI
  , bloomfilter
) {
    "use strict";
    // jshint esnext:true, newcap:false
    /*global clearTimeout, setTimeout*/

    const OMAError = errors.OMA
      , DeprecatedError = errors.Deprecated
      , assert = errors.assert
      , OMAIdError = errors.OMAId
      , ReceiverError = errors.Receiver
      , ValueError = errors.Value
      , KeyError = errors.Key
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
            de/serialization will be a big task
    Todo: InstanceData;
        - storage
        - serialization and cloning
            some rule when cloning is not needed. We don't have it immutable,
            yet, but for a translation action cloning is not needed.
            I.e. cloning is not needed if there's guaranteed just one user
            of the instanceData object. When there are more users a copy
            must be manufactured.
            NOTE: *instance.loadData* copies the data anyways

    Todo: get bootstrapping/root/root-apis straight;

    Todo: make baseInstances work <<<<< THIS!
          - also, are these part of InstanceData (I think yes) InstanceData.baseInstances!
          - baseInstances always share the same pattern
                -> to change a pattern of an instance all dependent instances
                   must also change the pattern. Dependency Tree ...
                -> obviously dependent instances are all instances that
                   have the instance as a baseInstance BUT ALSO
                   since one instance can have many baseInstances, all
                   co-baseInstances must be changed as well.
                -> we could allow different patterns for baseInstances,
                   but then deadlock tree operations on these patterns,
                   or mark instances as conflicting when they are based
                   on different essences. The conflicting model is a nice
                   idea but a later stage feature.
                -> to get all instances based on an instance, it would be
                   good to have dependantInstances ready for lookup in the
                   instance. via that, co-bases can simply be located.
                -> a instance itself stores baseInstances.
                   dependantInstances and baseInstances thus is a redundant
                   set of information and must be kept in sync!
                -> baseInstances is the authoritative source, it will also
                   be stored in instanceData (serialized as indexPath, most
                   probably)
                -> the baseInstance tree must be acyclic. There's not other
                   way (would create circular dependencies in CPS), this
                   needs to be checked when base Instances are set.

    Todo: make fork,translate,merge actions work!
            -> is `reassign` in OMAController equivalent to `translate`?
               if not, how do they differ?
            -> is `reassign` equivalent to `merge`?
               if not, how do they differ?
            -> seems like reassign may be a lower level api to do
               merge/translate
            -> fork/clone -> good to have
            -> how to deep **copy** and move instance data, especially
               considering incompatibility in base instances.
                    -> maybe, we'll have to solve this by hand in the beginning
                       or we clone/deep copy the whole baseInstancesCluster!
    Todo: revisit circular dependencies in patterns. How to implement it?
            -> looks like we'll have to physically create all repeated
               patterns. Thus, it would be nice to keep them somehow separate,
               so that they are only controlled by the repetition mechanism.
    Todo: do we want a *defaultProperties*  propertyDict, which
          has the lowest precedence, but otherwise is similar to properties
          maybe, it would have an own `defaults` accessor from CPS.
          This is related to how we will to use the data from baseInstances.
          A similar/related concept is the transparent instance that is
          attached to a mixed instance. Something like defaultProperties
          could help to make a transparent instance superfluous or at least
          to enable a transparent instance. defaultProperties would
          contain the recipe how to mix the baseInstances.
          Taking this idea further, a "base" instance that contains all
          original data before CPS-transformations could be accessible
          via normal CPS and would not by default need to be used as a
          baseInstance. Maybe, though, defaultProperties is redundant
          and this is the example thatshows it …
    Todo: how to access/mix baseInstances
          -> do we need a better property language already?
          -> maybe, for the moment, we can hard-code it, as we did before
          -> Bauhaus Font won't need mixing, just direct access
          -> a one-rule that mixes all properties mechanism would be amazing
             maybe, later, with pattern-matching and operator overloading
             we can create a clean way that really uses just one function
             -> how would that be integrated into
     */

    function Instance(pattern, parent, data) {
        Object.defineProperty(this, 'nodeID', {value: getUniqueID()});

       if(parent instanceof RootAPI) {
           this._rootAPI = parent;
           Object.defineProperty(this, 'parent', {value: null});
           Object.defineProperty(this, 'root', {value: this});
        }
        else {
            this._rootAPI = null;
            Object.defineProperty(this, 'parent', {value: parent});
            Object.defineProperty(this, 'root', {value: parent.root});
        }

        // An instance is constituted by it's edge in the pattern
        // tree the edge is from: this.parent.pattern to this.pattern
        // the instances index in parent must be the same index as
        // the according index of this.pattern in this.parent.pattern.children.
        // It is also depending on the parent instances in the instance tree
        // i.e. if a pattern is used many times, each edge to it's children
        // will constitute many instances.
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

        this._registeredBaseInstances = new Set();
        this._instanceBasedOnThis = new Set();

        this._data = new InstanceData(this.pattern.makeProperty);
        if(data)
            this.loadData(data);

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
        this._pattern = null;
        this._patternOff = null;
        this.pattern = pattern;// setter ...

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
        return this.pattern.getValidator(key);
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

    _p.walkTreeDepthFirst = function(callback) {
        var i,l;
        callback(this);
        for(i=0,l=this._children.length;i<l;i++)
            this._children[i].walkTreeDepthFirst(callback);
    };

    // START INSTANCE DATA

    Object.defineProperty(_p, 'data', {
        get: function() {
            return this._data;
        }
    });

    this.loadData = function(instanceData) {
        // FIXME: unless instanceData is immutable we have to copy
        // it here. Also, doing it this way triggers all connected
        // subscriptions.
        this.id = instanceData.id;
        this.setClasses(instanceData.classes);
        this.attachData(instanceData.dumpAttachment());
        this._data.loadProperties(instanceData.dumpProperties());
        this.setBaseInstances(instanceData.baseInstances);
    };

    Object.defineProperty(_p, 'properties', {
        get: function() {
            return this._data.properties;
        }
        , enumerable: true
    });

    _p.setClass = function(name) {
        if(this._data.setClass(name)) {
            this._bloomFilter = null;
            this._triggerPropertyChange('classes');
        }
    };

    _p.setClasses = function(classes) {
        if(this._data.setClasses(classes)) {
            this._bloomFilter = null;
            this._triggerPropertyChange('classes');
        }
    };

    _p.removeClass = function(name) {
        if(this._data.removeClass(name)) {
            this._bloomFilter = null;
            this._triggerPropertyChange('classes');
        }
    };

    _p.hasClass = function(name) {
        return this._data.hasClass(name);
    };

    Object.defineProperty(_p, 'classes', {
        get: function() {
            return this._data.classes;
        }
      , enumerable: true
    });

    _p.attachData = function(key, value) {
        return this._data.attachData(key, value);
    };

    _p.detachData = function(key) {
        return this._data.detachData(key);
    };

    _p.getAttachment = function(key, searchInBaseNodeChain) {
        return this._data.getAttachment(key, searchInBaseNodeChain);
    };

    _p.updateId = function(id) {
        var node = this.parent.getById(id);
        if (node !== this)
            throw new OMAIdError(this + 'can\'t update id to "'+ id
                        + '", it\'s registered for another node: '+ node);

        if(this._data.setId(id)) {
            this._bloomFilter = null;
            this._id = id || null;
            this._triggerPropertyChange('id');
        }
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
            this.parent.requestSetId(this, id);
        }
      , get: function(){ return this._data.id; }
    });

    _p.isBasedOn = function(instance) {
        var baseBases = [instance], toCheck;
        while((toCheck = baseBases.pop())) {
            if(this === toCheck)
                return true;
            Array.prototype.push.apply(baseBases, toCheck.baseInstances);
        }
        return false;
    };

    // TODO: even if instances is initially null, this must always run
    // to register this as instance based on other instances.
    // AND, even worse, when this depends on parent, it must also run when
    // parent changes it's bases! Well, parent should probably just run this
    // in the case! Make a updateRegisteredBaseInstances() method ... ?
    // it's funny, if parent changes it's base instances, we don't know
    // the old ones in here and can't unregister ... therefore we are fucked
    // ... thus references to baseInstances must be cached, even when
    // determinded via parent!

    _p.updateRegisteredBaseInstances = function() {
        var currentBases = new Set(this.baseInstances);

        for(let instance of this._registeredBaseInstances) {
            if(!currentBases.has(instance))
                instance.unregisterBasedInstance(this);
        }

        this._registeredBaseInstances.clear();

        for(let instance of currentBases) {
            instance.registerBasedInstance(this);
            this._registeredBaseInstances.add(instance);
        }

        for(let instance of this.children)
            instance.updateRegisteredBaseInstances();
    };

    _p.setBaseInstances = function(instances) {
        var i, l, instance
          , wrongRoot = []
          , circularDeps = []
          , wrongPattern = []
          , messages = []
          ;
        if(instances !== null) {
            for(i=0,l=instances.length;i<l;i++) {
                instance = instances[i];
                if(instance.root !== this.root)
                    wrongRoot.push(instance);
                if(instance.pattern !== this.pattern)
                    wrongPattern.push(instance);
                if(this.isBasedOn(instance))
                    circularDeps.push(instance);
            }

            if(wrongRoot.length)
                // is there any scenario this could be not required?
                messages.push('Can\'t insert instances: ' + wrongRoot.join(', ')
                            + ' as baseInstances, they must have the same '
                            + 'root as ' + this);

            if(wrongPattern.length)
                messages.push('Can\'t insert instances: ' + wrongPattern.join(', ')
                            + ' as baseInstances, they must be instances of the same '
                            + 'pattern as ' + this);

            if(circularDeps.length)
                messages.push('Can\'t insert instances: ' + circularDeps.join(', ')
                            + ' as baseInstances, they are (maybe indirectly) '
                            + 'based on this instance '
                            + this);

            // when there's a UI for this we should improve reporting
            if(messages.length)
                throw new OMAError(messages.join('\n'));
        }
        let [changed, ] = this._data.setBaseInstances(instances);
        if(changed)
            this.updateRegisteredBaseInstances();

            FIXME; // depending on the value, we must subscribe to
                   // parent baseInstances changes
            // FIXME; // trigger -> the StyldeDict needs cache invalidation
        // TODO:
        // optionally, do the "same" for all children, so that all of
        // the tree is based on all of the other tree... ?

    };

    /**
     * It's kind of natural to have all instances of a tree based on the
     * equivalent instances of the baseInstances tree.
     * Usually, that should be the default case! then an "instancesTree"
     * is based on other "instancesTrees". In fact, I believe that this
     * is so common, it should be the default behavior, and specific
     * overrides in the instancesTree baseInstances would be a (more specific)
     * exception.
     *
     * if(this._data.baseInstances === null)
     *      this.baseInstances = this.parent.baseInstances.map(
     *                          instance => instance.getChild(this.index))
     *
     * To make that the default, a value of `null` for this._data.baseInstances
     * indicates the default, while an empty array is explicit for
     * "no base instances" and an array with base instances
     * consequently defines the base instances, regardless of the parent
     * base instances.
     */
    Object.defineProperty(_p, 'baseInstances', {
        get: function() {
            var baseInstances = this._data.baseInstances;
            if(baseInstances !== null)
                // must be an array
                return baseInstances;

            if(!this.parent)
                return [];

            function getMyBases(instance) {
                //jshint validthis: true
                // this is guaranteed to work, because baseInstances
                // share the same pattern.
                return instance.getChild(this.index);
            }
            // We must react to changes of this.parent.baseInstances.
            // See: updateRegisteredBaseInstances which is responsible
            // to detect and act on changed baseInstances
            return this.parent.baseInstances.map(getMyBases, this);
        }
        , enumerable: true
    });

    // END INSTANCE DATA

    Object.defineProperty(_p, 'pattern', {
            /**
             * To change a pattern of an instance all dependent instances
             * in the baseInstances cluster must also change the pattern.
             * The child instances also must change the pattern accordingly.
             *
             * Changing the pattern of an instance is only allowed if the
             * new pattern has the same essence. Thus, the identity of
             * the pattern changes, but all structure stays in tact!
             *
             * Calling this setter directly is a bad idea in most cases.
             * Instead, _OMAController has methods for this kind of action.
             * _OMAController will also take care that the baseInstances
             * cluster and children are handled appropriately.
             */
        set: function(pattern) {
            if(pattern === this.pattern)
                // it's very common that a sub-tree-pattern is identical, but
                // the parent tree changed. So at some point, we can just stop
                // changing patterns. E.g. for nodes with frozen children,
                // there's no need ever to have different patterns, because
                // they will always keep the same essence.
                return;
            if(!this.pattern.isEssenceCompatible(pattern))
                throw new OMAError('Can\'t replace this.pattern ' + this.pattern
                    + ' with ' + pattern + ' the essences are not compatible');

            // this must go from top to bottom!
            if(this.parent.pattern.getChild(this.index) !== pattern)
                throw new OMAError('Can\'t replace this.pattern ' + this.pattern
                    + ' with ' + pattern + ' it\'s not the same as '
                    + 'this.parent.pattern.getChild(this.index)'
                    );
            this._pattern = pattern;
            if(this._patternOff)
                this._patternOff();
            this._patternOff = this.pattern.on(['inserted', 'removed']
                                            , [this, 'essenceChangeHandler']);
            this.parent.pattern.registerEdgeInstance(this);
        }
      , get: function(){return this._pattern;}
      , enumerable: true
    });

    _p.getBaseInstancesCluster = function() {
        var cluster = new Set()
          , instances = [this]
          , instance
          ;
        while((instance = instances.pop())) {
            if(cluster.has(instance))
                continue;
            cluster.add(instance);
            instances.push(...instance.baseInstances, ...instance.instancesBasedOnThis);
        }
        return cluster;
    };

    /**
     * How to find `instanceBasedOnThis`?
     * It's like readers of a book, you don't know them, unless they
     *  register themselves.
     *
     * Alternatively, we could iterate over all instances of the pattern.
     *
     * This may be called multiple times with the same instance
     */
    _p.registerBasedInstance = function(instance) {
        this._instancesBasedOnThis.add(instance);
    };

    // this must be called also when the instance ceases to exist, just
    // like any registrations need to be cancelled.
    // need to call: `this._patternUnsubscribe()` as well!
    _p.unregisterBasedInstance = function(instance){
        this._instanceBasedOnThis.delete(instance);
    };

    Object.defineProperty(_p, 'instancesBasedOnThis', {
        get: function() {
            return  this._instancesBasedOnThis;
        }
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
        if(this.parent)
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
        this._removeFromTree(item); // good???
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

    _p.lookupIndexPath = function(indexPath) {
        var path, instance, i, l;

        function toInt(idx){ return parseInt(idx, 10);}

        if(indexPath[0] === '/') {
            // absolute path
            instance = this.root;
            indexPath = indexPath.slice(1);
        }
        else
            // relative path
            instance = this;

        path = indexPath.split('/').map(toInt);
        // walk the path
        for(i=0,l=path.length;i<l;i++) {
            instance = instance.getChild(path[i]);
            if(!instance) {
                throw new KeyError('Can\'t resolve path "'+ indexPath
                                 +'", no instance found for path item at '
                                 + i + ' ('+path[i]+').');
            }
        }
        return instance;
    };

    //////////////////////
    // -> START ID-MANAGER
    //////////////////////
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
            throw new OMAError('Instance ' + descendant + ' can\'t '
                                    + 'requestSetId from this ' + this);
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

    ////////////////////
    // <- END ID-MANAGER
    ////////////////////

    _p.isRoot = function() {
        // ===. return this.parent === null
        return !!this._rootAPI;
    };

    Object.defineProperty(_p, 'rootAPI', {
        get: function() {
            return this.isRoot() ? this._rootAPI : this.root.rootAPI;
        }
    });

    _p.query = function(selector) {
        return this.rootAPI.query(selector, this);
    };

    _p.queryAll = function(selector) {
        return this.rootAPI.queryAll(selector, this);
    };

    _p.getComputedStyle = function() {
        return this.rootAPI.getComputedStyleFor(this);
    };

    _p._removeFromTree = function(item) {
        return this.rootAPI.removeFromTree(item);
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
          , id, i, l
          , classes
          ;
        data = [this.type];

        id = this.id;
        if(id)
            data.push('#' + id);

        classes = this.classes;
        for(i=0,l=classes.length;i<l;i++)
            data.push('.' + classes[i]);

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
