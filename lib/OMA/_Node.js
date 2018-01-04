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
      , OMAIdError = errors.OMAId
      , ValueError = errors.Value
      , KeyError = errors.Key
      , NotImplementedError = errors.NotImplemented
      , assert = errors.assert
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
        this._childrenData = new Map();
        this._ids = this.idManager ? Object.create(null) : null;

        this._attachedData = null;

        // Todo: all these dependencies to parent should be managed together
        // This also includes references to multiverse, universe etc.
        // Managed together means we could store them lazily at a this._parentDeps
        // object and could then bulk delete them when parent changes and such.
        this._parent = null;
        this._index = null;
        this._tailIndex = null; // index from the end, needed for cache invalidation
        this._indexPaths = Object.create(null);

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

    // Only necessary if the properties are on the _cps_whitelist
    // The value here should also be the key in _cps_whitelist
    // *NOT* the value.
    // This is needed for cache invalidation in StyleDict.
    _p._propertiesDependentOnParent = ['parent', 'root'];

    /* This is very unspecific on purpose, I can think of lots of
     * options to define validators for different purposes.
     * One of the biggest alternatives was to inject them via
     * the CPS-Controller into StyleDict, which would make the
     * validators of an OMA implementation configurable per application.
     * If that kind of freedom is needed (I think this is rather
     * a bad idea), then the object model could add a setValidator
     * method, operated by the CPS-Controller, for example.
     * However, to make an OM behave constantly across applications
     * (I think this is desirable) it is good to attch these
     * validators to the object model.
     */
    _p._getValidator = function(key) {
        //jshint unused:false
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

    /**
     * A bitmask (integer number) with the flags:
     *      cloneId           =    1
     *      cloneClasses      =    2
     *      cloneProperties   =    4
     *      cloneAttachedData =    8
     *      setBaseNode       = 0x10
     *      cloneBaseNode     = 0x20
     *
     * If both flags "setBaseNode" and "cloneBaseNode" are set
     * "setBaseNode" wins.
     */
    _p.clone = function(cloneFlags) {
        var clone = new this.constructor();
        this.finishClone(clone, cloneFlags);
        return clone;
    };

    _p.finishClone = function(clone, cloneFlags) {
        var frozenChildren = Object.isFrozen(this._children), i, l
          , child, cloneChild
          ;
        this.cloneProperties(clone, cloneFlags);
        for(i=0,l=this._children.length;i<l;i++) {
            child = this._children[i];
            if(!frozenChildren)
                // back on track!
                clone.add(child.clone(cloneFlags));
            else {
                // the constructor made that child
                cloneChild = clone.getChild(i);
                child.finishClone(cloneChild, cloneFlags);
            }
        }
    };

    _p._cloneAttachedData = function(clone) {
        var data = this._dumpAttachment();
        if(data)
            clone.attachData(data);
    };

    _p.cloneProperties = function(clone, cloneFlags) {
        var flags = cloneFlags === undefined
                ? (1|2|4|8) // default: all but base nodes
                : cloneFlags
          , cloneId = flags & 1
          , cloneClasses = flags & 2
          , cloneProperties = flags & 4
          , cloneAttachedData = flags & 8
          , setBaseNode = flags & 0x10
          , cloneBaseNode = flags & 0x20
          ;
        if(cloneId && this._id)
            clone.id = this._id;

        if(cloneClasses)
            clone.setClasses(this.classes);

        if(cloneProperties)
            clone.properties.splice( 0, clone.properties.length
                                   , this.properties.items );

        if(cloneAttachedData)
            this._cloneAttachedData(clone);

        if(setBaseNode)
            clone.baseNode = this;
        else if(cloneBaseNode && this._baseNode)
            clone.baseNode = this._baseNode;
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
                // mark for reset
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
        // FIXME: delay StyleDict invalidation
        if('id' in data)
            this.id = data.id;

        if('classes' in data)
            this._loadClasses(data.classes);

        if('properties' in data)
            this._loadProperties(makeProperty, data.properties);

        if('attachment' in data)
            this._loadAttachment(data.attachment);
    };

    _p._dumpChildren = function(dumpFunc, dumpFuncArguments) {
        var frozenChildren = Object.isFrozen(this._children)
          , childrenData, child, childData, i, l
          ;

        if(!this._children.length)
            return null;

            childrenData = [];
        for(i=0,l=this._children.length;i<l;i++) {
            child = this._children[i];
            childData = child[dumpFunc].apply(child, dumpFuncArguments || []);
            if(!frozenChildren)
                // we need the type to know what node type to rebuild
                childData = [child.type, childData];
            // else: having the type in data is redundant.
            childrenData.push(childData);
        }
        return childrenData;
    };

    _p._loadChildren = function(loadFunc, factoryFunc, childrenData) {
        var frozenChildren = Object.isFrozen(this._children)
          , children, i, l, child, type, childData, Constructor
          ;
        if(!frozenChildren)
            children = [];
        for(i=0,l=childrenData.length;i<l;i++) {
            if(frozenChildren) {
                // we don't build this, the constructor should have done
                // so before.
                child = this._children[i];
                if(!child)
                    // The data is invalid (or the concrete OMA
                    // implementation is flawed).
                    throw new OMAError('Child is missing. The data suggests '
                                + 'that a child should be at index '+ i
                                + 'in ' + this);
                childData = childrenData[i];
                if(childData !== null)
                    child[loadFunc](childData);
                continue;
            }

            // Not frozen children.
            type = childrenData[i][0];
            childData = childrenData[i][1];
            Constructor = this.getChildConstructor(type);
            if(typeof Constructor[factoryFunc] === 'function')
                // A factory function is a mighty way to make more customized
                // constructors, because the standard is having no constructor
                // arguments. If using this, you probably want to customize
                // the accoding dump methods as well, to include extra data
                // factory and, in consequence, the constructor.
                child = Constructor[factoryFunc](childData);
            // this is the default
            else {
                child = new Constructor();
                if(childData !== null)
                    child[loadFunc](childData);
            }
            children.push(child);
        }
        if(!frozenChildren)
            this.splice(0, this._children.length, children);
    };

    /**
     * Return an array of arrays [
     *      [this.children[n].type, this.children[n].getEssence()],
     *      ...
     * ]
     * NOTE: there is some variation possible in the return value for
     * OMA implementations. However, the return value of this method will
     * likely be used to compare essences and to perform distinct actions
     * based on that and thus should really only be altered when carefully
     * considered. It is much safer to change dumpData/loadData and
     * in most cases the right thing to do anyways.
     *
     * If you don't change the semantic of the "essence" it should be fine.
     *
     * The return value must be serializable via JSON.stringify or yaml.safeDump
     *
     * TODO: write and link to documentation about the "essence" concept.
     *
     * In short, essence is the tree information without the data.
     * I.e. amount, type and and order of all descendants but not ids,
     * classes, properties and attachment.
     */
    _p.dumpEssence = function() {
        return this._dumpChildren('dumpEssence');
    };

    _p.dumpTree = function(simpleProperties) {
        var data = this.dumpData(simpleProperties)
          , childrenData = this._dumpChildren('dumpTree', [simpleProperties])
          ;
        if(childrenData) {
            if(!data)
                data = Object.create(null);
            data.children = childrenData;
        }
        return data;
    };

    /**
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

    /**
     * This replaces all children with new ones created from the information
     * in "essences"
     *
     * If essences is an empty array, this deletes all children, just like
     * node.splice(0, node.childrenLength);
     */
    _p.loadEssence = function(essences) {
        if(essences)
            this._loadChildren('loadEssence', 'fromEssence', essences);
    };

    _p.loadTree = function(data) {
        if(data)
            this.loadData(data);
        if(data.children)
            this._loadChildren('loadTree', 'fromTree', data.children);
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
        if(searchInBaseNodeChain && this._baseNode)
            return this._baseNode.getAttachment(key, searchInBaseNodeChain);
    };

    _p.hasBaseNode = function() {
        return !!this._baseNode;
    };

    /**
     * baseNode gives this node it's essence and some of the data.
     * FIXME: It will require a bigger effort to straighten this concept
     * out. Consider this as a stub, at the moment, the application has
     * to do the work for this. MOM-Project uses this.
     * I keep this open for a later iteration.
     */
    Object.defineProperty(_p, 'baseNode', {
        get: function() {
            if(!this._baseNode)
                throw new KeyError(this + ' has no baseNode.');
            return this._baseNode;
        }
        // Note: the semantics of this baseNode concept are not yet fully
        // thought out. That's why I'm very stringent now with what
        // can be done with this thing.
      , set: function(node) {
            // I think this is set very short after creation of the
            // node. There won't be a kind of late base node setting.
            // We could even do this via the constructor. Then a node
            // could also lock this setter when it has no baseNode.
            // We wouldn't even need a setter in the first place.
            if(this._baseNode === node)
                return;
            if(this._baseNode && this._baseNode !== node)
                // I maybe want to make this the api to control metacomponents
                // then, setting this would have tremendous effects on the
                // children structure of this node. Until then, or until there
                // is a solution, re-setting is forbidden.
                throw new OMAError(this + 'already has already a baseNode '
                            + '('+node+') it is not allowed to change it.');
            if(node.type !== this.type)
                throw new OMAError('Node must be a "'+this.type+'", '
                                        + 'but it is "'+node.type+'".');
            // Prevent recursion! "this" must not equal node nor must
            // "this" be in the baseNode chain of node.
            var check = node;
            do {
                if(this === check)
                    throw new OMAError('Recursion in baseNode chain: '
                            + this + ' is already in the base nodes of '
                            + node + '.');
                check = check.hasBaseNode() && check.baseNode;
            } while(check);

            this._baseNode = node;
        }
    });

    // TODO: add standard serialize/deserialize methods here.
    // And, add a switch for a "simplified" export, where the data is
    // better human readable, just like the font data in BEF.

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
            throw new NotImplementedError('Implement CPS-Type name!');
        }
    });

    Object.defineProperty(_p, 'children', {
        /**
         * returns a copy of this._children so we can't mess around
         * with the list of children via public interfaces.
         */
        get: function(){ return this._children.slice(); }
    });

    Object.defineProperty(_p, 'childrenLength', {
        /**
         * Faster than calling node.children.length, because that creates
         * a copy of this._children
         */
        get: function(){ return this._children.length; }
    });

    _p.getChild = function(index) {
        return this._children[index];
    };

    /**
     * Set this to true in a subclass if it should manage the ids of
     * it's descendants.
     */
    Object.defineProperty(_p, 'idManager', {
        value: false
    });

   _p.requestSetId = function(descendant, id) {
        if(!this.idManager)
            // this moves to root if no Node on the way is an idManager.
            return this.parent && this.parent.requestSetId(descendant, id);

        if(descendant.getIdManager() !== this)
            return false;
        // this node is responsible
        return this._setDescendantId(descendant, id);
    };

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
            return this.parent && this.parent.removeSubtreeIds(descendant);
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
            return this.parent && this.parent.addSubtreeIds(descendant);
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
            return this.parent && this.parent.getById(id);
        return this._ids[id];
    };

    _p.getIdManager = function() {
        var parent = this.parent;
        while(parent) {
            if(parent.idManager)
                return parent;
            parent = parent.parent;
        }
        return false;
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
        if(!this.parent)
            return;
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
            var managed = this.parent && this.parent.requestSetId(this, id);
            if(!managed || id === null)
                _setId.call(this, id);
        }
      , get: function(){ return this._id; }
    });

    _p._rootType = 'root';

    _p.isRoot = function(){
        return (this.type === this._rootType);
    };

    /***
     * get the root element of this node.
     */
    Object.defineProperty(_p, 'root', {
        get: function() {
            if(!this._parent)
                return null;
            if(this._parent.isRoot())
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

    _p._setCLass = function(name) {
        this._bloomFilter = null;
        if(!(name in this._classes)){
            this._classes[name] = null;
            return true;
        }
        return false;

    };
    _p.setClass = function(name) {
        if(this._setCLass(name))
            this._triggerPropertyChange('classes');
    };

    _p.setClasses = function(classes) {
        var i, l, changed;
        for(i=0,l=classes.length;i<l;i++) {
            changed = this._setCLass(classes[i]) || changed;
        }
        if(changed)
            this._triggerPropertyChange('classes');
    };

    _p.removeClass = function(name) {
        this._bloomFilter = null;
        if(name in this._classes[name]) {
            delete this._classes[name];
            this._triggerPropertyChange('classes');
        }
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

    _p.toString = function() { return ['<', this.type, ' ', this.nodeID, '>'].join('');};

    _p.isOMANode = function(item) {
        return item instanceof _Node;
    };

    /**
     *  enhance this dict with accepted children type: Constructor pairs
     */
    _p._acceptedChildren = Object.create(null);

    _p.qualifiesAsChild = function(item) {
        if(!this.isOMANode(item) || item === this)
            return false;

        if(item.type in this._acceptedChildren
                    && item instanceof this._acceptedChildren[item.type])
            return true;
        return false;
    };

    _p.getChildConstructor = function(type) {
        var Constructor = this._acceptedChildren[type];
        if(!Constructor)
            throw new KeyError('No child constructor found for type "'
                                            + type + '" in ' + this);
        return Constructor;
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
        var data = this._childrenData.get(item);
        return data === undefined ? false : data[0];
    };

    Object.defineProperty(_p, 'index', {
        get: function(){ return this._index;}
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
        var key = stopNode && stopNode.nodeID || ''
          , indexPath = this._indexPaths[key]
          , parentIndexPath
          ;
        if(!indexPath) {
            if(this.isRoot())
                // makes this an "absolute" path, analogous to how a
                // filesystem path would look like, i.e. starting with
                // a slash.
                indexPath = '/';
            if(this === stopNode)
                indexPath = '.';
            else if(!this.parent)
                indexPath = this._index;
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

                this._triggerPropertyChange(this._propertiesDependentOnParent);
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
            this._triggerPropertyChange(this._propertiesDependentOnParent);
        }
      , get: function(){ return this._parent; }
    });

    /**
     * This method is only called by the node and the parent node and
     * has no effect if index did not change for real!
     */
    _p.updateIndex = function() {
        var index = this._parent // if there is a parent, there is an index.
                    ? this._parent.find(this)
                    : null
          , tailIndex = index !== null
                    ? this._parent.childrenLength - index - 1
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

        this._triggerPropertyChange(changed);
    };


    _p._getCanonicalStartIndex = function(start, length) {
        if(start >= length)
            return length;
        if(start < 0)
            return Math.max(0, length - start);
        return start;
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

    /**
     * Remove doubles, the last position wins.
     *
     * This is similar to running add with an existing item, it will
     * be positioned at the end then.
     *
     * The items-list argument is changed in place.
     */
    _p._removeDoubles = function(items) {
        var seen = new Set()
          , i, item
          ;
        for(i=items.length-1;i>=0;i--) {
            item = items[i];
            if(!seen.has(item))
                seen.add(item);
            else
                items.splice(i, 1);
        }
    };

    _p.splice = function(startIndex, deleteCount, _insertions /* single item or array of items */) {
        if(Object.isFrozen(this._children))
            throw new OMAError('Adding or removing children is not allowed in this element.');

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
          , canonicalStartIndex = this._getCanonicalStartIndex(startIndex, this._children.length)
          , moveIndexes
          , idx, data
          , insertionsEndIndex, delta, indexChanged
          , subscription
          , root = this.root
          ;

        this._removeDoubles(insertions);

        for(i=0,l=insertions.length;i<l; i++) {
            item = insertions[i];
            if(!this.qualifiesAsChild(item))
                throw new OMAError([this, 'doesn\'t accept', item
                                        , 'as a child object.'].join(' '));
        }

        // MOVING WITHIN THIS NODE

        // If item is already a child of this it's a "move"
        moveIndexes = insertions.map(function(item) {
                return (item.parent === this) ? item.index : -1;
            }, this);
        // The order is important!
        moveIndexes.sort();
        for(i=moveIndexes.length-1;i>=0;i--) {
            idx = moveIndexes[i];
            if(idx === -1) continue;
            // moveIndexes is ordered so that the higher indexes is this._children
            // are coming first (Note:iterating from the end), thus preserving
            // the validity of lower indexes
            this._children.splice(idx, 1);

            // Changing deleteCount makes two equivalent cases:
            //     Delete + Insert: [A,B,C].splice(1,1,[B]) => [A,B,C] // not [A, B] return [C]
            //     Move: [A,B,C].splice(1,0,[B]) => [A,B,C]
            // To replace C: [A,B,C].splice(2,1,[B]) => [A,B]
            // In the former case, removing C seems counter intuitive,
            // because it is not at index 1 when calling splice.
            // We do this before changing canonicalStartIndex, so that the
            // intention is still included in the value
            if(idx >= canonicalStartIndex && idx < canonicalStartIndex + deleteCount)
                // don't delete this two times ...
                // I think this makes sense, because
                deleteCount -= 1;

            // We change canonicalStartIndex here, because I think that we
            // we can preserve a semantic of insert one node after another
            // I.e. for drag and drop interfaces or so:
            //      In: [A,B,C,D,E] to insert B:(1) after D:i(3)
            //      Do: [A,B,C,D,E].splice(D.index + 1, 0, [B]) => [A,C,D,B,E]
            // FIXME: For PropertyCollection this is not implemented in splice
            // and the Atem-CPS-DeveloperTool/cpsPanel/collection-controller
            // takes care of this case (in moveCPSElement) so this is a
            // deviation of that splice API! I'm not sure which version
            // is better, so I implement changing canonicalStartIndex
            // here and we'll have to re-evaluate later.
            // Eventually I wan't to have all splice APIs implemented consistently!

            // don't make it smaller than 0!
            if(idx <= canonicalStartIndex && canonicalStartIndex > 0)
                canonicalStartIndex -= 1;
        }
        // this._children.length might have changed while preparing the moves
        canonicalStartIndex = Math.min(canonicalStartIndex, this._children.length);

        // END MOVING

        // PERFORM
        args = [canonicalStartIndex, deleteCount];
        Array.prototype.push.apply(args, insertions);
        deleted = Array.prototype.splice.apply(this._children, args);

        // CLEANUP DELETIONS
        for(i=0,l=deleted.length;i<l;i++) {
            // assert item not in insertions!
            item = deleted[i];
            data = this._childrenData.get(item);
            this._childrenData.delete(item);
            item.offPropertyChange(data[1]);
            item.parent = null;
            this.removeSubtreeIds(item);
            if(root) {
                // must also clean all children
                item.lostRoot();
                root.removeFromTree(item);
            }
            this._unsubscribeFromStyleChange(item);
        }

        // REGISTER INSERTIONS
        for(i=0,l=insertions.length;i<l;i++) {
            item = insertions[i];
            idx = canonicalStartIndex + i;

            if(item.parent === this) {
                // This was a move (same parent)
                // Keep the subscription, and just update index.
                this._childrenData.get(item)[0] = idx;
                item.updateIndex();
                continue;
            }

            if(item.parent !== null)
                // Came from another parent.
                item.parent.remove(item);

            // property changes in ['subtree', 'id', 'classes', 'essence']
            // trigger themselves a property change event for in this node.
            // i.e. they bubble upwards
            subscription = item.onPropertyChange(['essence', 'subtree', 'id', 'classes']
                                    , [this, '_childEventRealaisHandler']);
            this._childrenData.set(item, [idx, subscription]);
            item.parent = this; // calls item.updateIndex();
            this.addSubtreeIds(item);
            this._subscribeToStyleChange(item);
            if(root)
                item.gainedRoot();
        }

        delta = insertions.length - deleted.length - moveIndexes.length;
        insertionsEndIndex = canonicalStartIndex + insertions.length;
        for(i=0,l=this._children.length;i<l;i++) {
            item = this._children[i];
            if(i>=canonicalStartIndex && i<insertionsEndIndex)
                // we just covered that in the insertions loop.
                continue;

            if((indexChanged = item.index !== i))
                // update index
                this._childrenData.get(item)[0] = i;

            if(delta || indexChanged)
                // if delta: tailIndex changed for all
                item.updateIndex();
        }

        // TODO: edge case: If there was a move but it didn't
        // change anything, this would still _triggerPropertyChange.
        // we could save a list of children ids or something at the
        // beginning and compare to at the end to be certain.
        if(deleted.length || insertions.length || moveIndexes.length)
            this._triggerPropertyChange(['children', 'essence', 'subtree']);
        return deleted;
    };

    _p.remove = function(item) {
        var idx = this.find(item);
        if(idx === false)
            throw new OMAError([this, 'can\'t remove', item ,'because',
                                'it is not a child.'].join(' '));
        this.splice(idx, 1);
        return true;
    };

    _p.add = function(item) {
        this.splice(this._children.length, 0, item);
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
        this._cpsChange.timeoutId = setTimeout(this._cpsChange.trigger);
    };

    _p.flushStyleChanges = function() {
        var style, i, l;
        if(this._cpsChange.timeoutId)
            clearTimeout(this._cpsChange.timeoutId);
        this._cpsChange.timeoutId = null;
        this._cpsChange.eventData = [];
        style = this.getComputedStyle();
        style.flushStyleChanges('change');
        for(i=0,l=this._children.length;i<l;i++)
            this._children[i].flushStyleChanges();
    };

    _p._unsubscribeFromStyleChange = function(item) {
        var changeSubscriptions = this._changeSubscriptions
          , subscription, k
          ;
        if(!changeSubscriptions)
            return;
        if(!item) {
            // without item remove all subscriptions
            for(k in changeSubscriptions) {
                subscription = changeSubscriptions[k];
                subscription[0].off(subscription[1]);
                delete changeSubscriptions[k];
            }
        }
        else {
            k = item === this ? '_styleDict_' : item.nodeID;
            subscription = changeSubscriptions[k];
            if(subscription) {
                subscription[0].off(subscription[1]);
                delete changeSubscriptions[k];
            }
            // else: not subscribed, should we fail here?
        }
    };

    _p._subscribeToStyleChange = function(item) {
        var changeSubscriptions = this._changeSubscriptions
          , callback
          , style
          , k, subscription
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
            subscription = [style, style.on('change', callback)];
        } else
            subscription = [item, item.on('CPS-change', callback)];
        changeSubscriptions[k] = subscription;
    };

    _p.lostRoot = function() {
        var i, l;
        assert(!this.root, this + 'must not have a root.');
        this._unsubscribeFromStyleChange(this);
        for(i=0,l=this._children.length;i<l;i++)
            this._children[i].lostRoot();
    };

    _p.gainedRoot = function() {
        var i, l;
        assert(!!this.root, this + 'must have a root.');
        this._subscribeToStyleChange(this);
        for(i=0,l=this._children.length;i<l;i++)
            this._children[i].gainedRoot();
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
            if(this.root)
                // only if we have root
                this._subscribeToStyleChange(this);
            children = this._children;
            for(i=0,l=children.length;i<l;i++)
                this._subscribeToStyleChange(children[i]);
        }
        changeSubscriptions.counter += 1;
    };

    _p._deinitCPSChangeEvent = function(subscriberID) {
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
                if(subscriberID[i][0] === 'CPS-change') {
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

    return _Node;
});
