define([
    'Atem-CPS/errors'
  , './parsing/parseRules'
  , 'obtain/obtain'
  , 'Atem-IO/tools/readDirRecursive'
], function(
    errors
  , parseRules
  , obtain
  , readDirRecursive
) {
    "use strict";
    /* global setTimeout:true*/

    var KeyError = errors.Key
      , CPSRecursionError = errors.CPSRecursion
      , NotImplementedError  = errors.NotImplemented
      , ValueError = errors.Value
      ;

    // FIXME: note that we have a race condition in here:
    //        One request with an older result can respond after
    //        a newer result was cached, the most obvious example
    //        is:
    //              ruleController.getRule(true, name)
    //              ruleController.getRule(false, name)
    //
    //        The second call will write the cache before the first call.
    //        This problem exists with all asynchronous requests, of
    //        course, but in this case it is more probable.
    //        See the implementation of `getRule` (the `rule` getter)
    //        for an attempt to improve the situation, and a further comment.

    function RuleController(io, cpsDir, initializePropertyValue, selectorEngine) {
        this._io = io;
        this._cpsDir = cpsDir;
        this._commissionIdCounter = 0;
        this._rules = Object.create(null);
        this._cpsGenerators = Object.create(null);
        this._generatedRules = Object.create(null);
        Object.defineProperty(this, 'initializePropertyValue', {
            value: initializePropertyValue
          , enumarable: true
          , writable: false
        });
        Object.defineProperty(this, 'selectorEngine', {
            value: selectorEngine
          , enumarable: true
          , writable: false
        });
        this._markDirtyCallback = [this, '_markDirtyHandler'];
    }

    var _p = RuleController.prototype;

    _p._isCached = function(sourceName) {
        return (sourceName in this._rules) && this._rules[sourceName].cached;
    };

    _p._markDirtyHandler = function(sourceName, channelKey, eventData) {
        //jshint unused: vars
        this._rules[sourceName].dirty = true;
    };

    _p._set = function(sourceName, rule, commissionId) {
        var record;
        if(!(sourceName in this._rules))
            record = this._rules[sourceName] = {
                propertyCollection: rule
              , subscription: rule.on('update', this._markDirtyCallback, sourceName)
            };
        else {
            record = this._rules[sourceName];
            record.propertyCollection.reset(rule.items, rule.source, rule.lineNo);
        }
        record.commissionId = commissionId;
        record.cached = true;
        record.dirty = false;
    };

    _p._readFile = function(async, fileName) {
                            return this._io.readFile(async, fileName); };

    _p._getFilePath = function(sourceName) {
        return [this._cpsDir, sourceName].join('/');
    };


    _p._getParseRulesArgumentAPI = function(importing) {
        // return the api needed by parseRules.fromString
        // but create a version of `_getRule` that is aware of the
        // @import history `importing`
        var api = {
              initializePropertyValue: this.initializePropertyValue
            , selectorEngine: this.selectorEngine
            , getRule: function ruleControllerGetRuleAPI(async, sourceName) {
                        return this._getRule(async, importing, sourceName);
              }.bind(this)
        };
        return api;
    };

    _p._getRule = obtain.factory(
        {
            fileName: ['importing', 'sourceName', function(importing, sourceName) {
                if(sourceName in importing)
                    throw new CPSRecursionError(sourceName + ' @imports itself: '
                                    + Object.keys(importing).join(' » '));
                importing[sourceName] = true;
                return this._getFilePath(sourceName);
            }]
          , cps: [false, 'fileName', 'commissionId', _p._readFile]
          , rule: ['cps', 'sourceName', 'commissionId', 'importing',
                function(cps, sourceName, commissionId, importing) {
                    if(!this._isCached(sourceName)
                            // There is a current cache but it was commissioned
                            // before this request, and finished loading before it.
                            // FIXME: a maybe better alternative would be
                            //        to fail here!
                            || this._isCached(sourceName) && commissionId >= this._rules[sourceName].commissionId)
                    {
                        var api = this._getParseRulesArgumentAPI(importing)
                          , rule = parseRules.fromString(cps, sourceName, api);
                        this._set(sourceName, rule, commissionId);
                    }
                    delete importing[sourceName];
                    return this._rules[sourceName].propertyCollection;
                }]
          , commissionId:[function(){ return this._commissionIdCounter++;}]
        }
      , {cps: [true, 'fileName', 'commissionId', _p._readFile]}
      , [ 'importing', 'sourceName']
      , function job(obtain, importing, sourceName) {
            if(this._isGeneratorPath(sourceName))
                return this._getGeneratedRule(sourceName, importing);
            if(!this._isCached(sourceName))
                obtain('rule');
            return this._rules[sourceName].propertyCollection;
        }
    );

    _p.getRule = function(async, sourceName) {
        // initial recursion detection stack
        var importing = Object.create(null);
        return this._getRule(async, importing, sourceName);
    };

    /**
     * FIXME: Make these rules write-only!
     */
    _p._generateRule = function(path, importing) {
        var generatorArgs = this._parseGeneratorPath(path)
          , name = generatorArgs[0]
          , version = generatorArgs[1]
          , args = generatorArgs[2]
          , cps, api, rule
          ;
        if(version !== 0)
            throw new NotImplementedError('There\'s yet no versioning API '
                                + 'for CPS generators. Version: ' + version);
        if(!(name in this._cpsGenerators))
            throw new KeyError('Unknown CPS generator "' + name + '"');
        if(path in importing)
            throw new CPSRecursionError(path + ' @imports itself: '
                                    + Object.keys(importing).join(' » '));
        importing[path] = true;
        cps = this._cpsGenerators[name].apply(null, args);
        api = this._getParseRulesArgumentAPI(importing);
        rule = parseRules.fromString(cps, path, api);
        delete importing[path];
        return rule;
    };

    _p._getGeneratedRule = function(path, importing) {
        var rule = this._generatedRules[path];
        if(!rule)
            this._generatedRules[path] = rule = this._generateRule(path, importing);
        return rule;
    };

    /**
     * Reload an existing CPS rule
     *
     * This is used with an file system monitoring event emitter.
     * But the concept as it is now plays bad with an interactive
     * environment. So that not both "sources of change" should be
     * used at the same time.
     *
     * It would be better to have just one "source of change",
     * a change in the file system source should be channeled into
     * the stream of changes of the the PropertyCollection itself,
     * just like user interaction. Thus, having a good diffing algorithm
     * would be a blast! And skipping all the updating in the case
     * of this.saveChangedRules is called would be wise!
     */
    _p.reloadRule = function(async, sourceName) {
        if(!(sourceName in this._rules))
            throw new KeyError('Can\'t reload rule "'+ sourceName
                                +'" because it\'s not in this controller');
        // mark as uncached
        this._rules[sourceName].cached = false;
        return this.getRule(async, sourceName);
    };

    /**
     * Create a new file or override an existing one
     *
     * FIXME/TODO:
     * Initially RuleController did only reading and re-reading of cps files.
     * Eventually we will also need creating, updating and removing of cps files
     * and PropertyCollections.
     * This will need some concept to work without race conditions and
     * in a reliable fashion.
     *
     * This method is very simple, it will create a new file or overide
     * an existing file. There is no guard that keeps this method from
     * overiding existing files, because the io api doesn't suppport that.
     *
     * Keep that in mind when using this method and if this behavior creates
     * a problem for your case, please report it, so that we can think of a
     * sound solution.
     */
    _p.write = function(async, sourceName, content) {
        var path
          , _content = content === undefined ? '' : content
          ;

        if(this._isGeneratorPath(sourceName))
            throw new ValueError('Can\'t write to generator path "' + sourceName + '".');

        path = this._getFilePath(sourceName);
        return this._io.writeFile(async, path, _content);
    };

    _p.saveRuleIfChanged = function(async, sourceName) {
        var rule = this._rules[sourceName], promise;
        if(rule && rule.dirty) {
            promise = this.write(async, sourceName, '' + rule.propertyCollection);
            rule.dirty = false;
        }
        if(async)
            return promise;
    };

    _p.saveChangedRules = function(async) {
        // FIXME: when there is a filesystem change handler, via reloadRule
        // the here saved files will be updated immediately.
        // We got to break that for performance reasons. Invalidating
        // and reloading all rules is a big performance hit and in this
        // case just unnecessary.
        var sourceName, rule, promises = [];
        for(sourceName in this._rules) {
            rule = this._rules[sourceName];
            if(rule.dirty) {
                promises.push(this.write(async, sourceName, '' + rule.propertyCollection));
                rule.dirty = false;
            }
        }
        if(!async) return;
        if(promises.length) return Promise.all(promises);
        return new Promise(function(resolve){setTimeout(resolve, 0);});
    };

    /**
     * Return all cps filenames within the cps directory.
     *
     * There may be more loadable rules when loaded with a relative sourceName.
     * But that is not supported by this method.
     *
     * FIXME: we'll need a solution for generated cps where this information
     *        is offered to the user as a list to chose from.
     */
    _p.getAvailableRules = obtain.factory(
        {
            files: [function() {
                return readDirRecursive(false, this._io, this._cpsDir);
            }]
          , trimmed: ['files', function(files) {
                var i,l
                  , result = []
                  , trimLength =  this._cpsDir.length+1
                  , file
                  ;
                for(i=0,l=files.length;i<l;i++) {
                    file = files[i];
                    if(file.slice(-4) !== '.cps')
                        continue;
                    result.push(file.slice(trimLength));
                }
                return result;
            }]
        }
      , {
            files: [function() {
                return readDirRecursive(true, this._io, this._cpsDir);
            }]
        }
      , []
      , function job (obtain) {
            return obtain('trimmed');
        }
    );

    _p.registerCPSGenerator = function(name, generator) {
        if(name in this._cpsGenerators)
            // To allow this would mean our caches are invalid.
            // If there's a need for this we may be able to develop
            // a way to do it.
            throw new ValueError('A generator with name "' + name + '" '
                                            + 'is already registered.');
        this._cpsGenerators[name] = generator;
    };

    /**
     * Actually we don't generate the CPS here, just the key.
     * The CPS is generate on demand.
     */
    _p._getGeneratorCPSKey = function(version, name, args) {
        if(version !== 0)
            throw new NotImplementedError('There\'s yet no versioning API '
                                + 'for CPS generators. Version: ' + version);
        if(!(name in this._cpsGenerators))
            throw new KeyError('Unknown CPS generator "'+name+'"');

        var keyArgs = args.join(',')
          , key = ['generated://', name, '/', version, '/',keyArgs].join('')
          ;
        return key;
    };

    /**
     * Return the "name" or "key" that ensures that the CPS will always
     * be the same.
     *
     * This creates a "virtual" rule only. I.E. RuleController
     * will intercept loading calls to it and generate the CPS on the fly,
     * instead of saving the CPS to IO.
     *
     * Call like: `ruleController.generateCPS('metapolation', [4]);`
     *
     * TODO: the key incudes a version argument placeholder.
     * We can establish versions when needed, for now, 0 is the default
     * and a new generator does not need to care. Once a second generator
     * version is introduced we'll have to implement it. Only if the
     * generator changes its meaning though.
     *
     * FIXME: That rule should be readOnly, once we can express that.
     */
    _p.generateCPS = function(name, args) {
        var version = 0
          // args must still work in an @import rule, so, for now just simple
          // stuff is allowed. More advanced parsing could be done in the
          // generator though. Eventually it would be nice to have this done
          // here, so that a generator can mind its own business and doesn't
          // have to parse.
          // If you have a good example where more expressiveness is needed,
          // please open an issue!
          // We might end up doing a "@generated" rule, instead of overloading
          // "@import" eventually.
          , key = this._getGeneratorCPSKey(version, name, args)
          ;
        return key;
    };

    _p._isGeneratorPath = function(path) {
        return (path.indexOf('generated://') === 0);
    };

    var _isFloatStringTest = /^([+-]?(((\d+(\.)?)|(\d*\.\d+))([eE][+-]?\d+)?))$/;
    function _parseCPSGeneratorArgument(arg) {
        var number;
        // does it look like a number?
        if(_isFloatStringTest.test(arg)) {
            number = parseFloat(arg);
            // did it parse as a number?
            if(number === number)
                return number;
        }
        // treat as a string
        return arg;
    }

    _p._parseGeneratorPath = function(path) {
        var data = path.slice('generated://'.length).split('/')
          , name = data[0]
          , version = parseInt(data[1], 10)
          , args = data[2] ? data[2].split(',') : []
          ;
        // TODO: this._cpsGenerators[ruleName] could provide its own parser.(?)
        args = args.map(_parseCPSGeneratorArgument);
        return [name, version, args];
    };

    return RuleController;
});
