var nav;
var victim_id;
var client;
var execute;
var swagger;
var api;
var TOC;
var data = {};

/**
 * 
 * code copied from https://github.com/Mermade/widdershins
 */
function escapeCarats (string) {
    var charMap = {
        '<' : '&lt;',
        '>' : '&gt;'
    };

    return String(string).replace(/[<>]/g, function(s) {
        return charMap[s];
    });
}

function jpescape(s) {
    s = s.split('~').join('~0');
    s = s.split('/').join('~1');
    return s;
}

function shallowClone(obj) {
    let result = {};
    for (let p in obj) {
        if (obj.hasOwnProperty(p)) {
            result[p] = obj[p];
        }
    }
    return result;
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
* unescapes JSON Pointer using ~0 for ~ and ~1 for /
* @param s the string to unescape
* @return the unescaped string
*/
function jpunescape(s) {
    s = s.split('~1').join('/');
    s = s.split('~0').join('~');
    return s;
}


// JSON Pointer specification: http://tools.ietf.org/html/rfc6901

/**
* from obj, return the property with a JSON Pointer prop, optionally setting it
* to newValue
* @param obj the object to point into
* @param prop the JSON Pointer or JSON Reference
* @param newValue optional value to set the property to
* @return the found property, or false
*/
function jptr(obj, prop, newValue) {
    if (typeof obj === 'undefined') return false;
    if (!prop || (prop === '#')) return (typeof newValue !== 'undefined' ? newValue : obj);

    if (prop.indexOf('#')>=0) {
        let parts = prop.split('#');
        let uri = parts[0];
        if (uri) return false; // we do internal resolution only
        prop = parts[1];
        prop = decodeURIComponent(prop.slice(1));
    }
    if (prop.startsWith('/')) prop = prop.slice(1);

    let components = prop.split('/');
    for (let i=0;i<components.length;i++) {
        components[i] = jpunescape(components[i]);

        let setAndLast = (typeof newValue !== 'undefined') && (i == components.length-1);

        let index = parseInt(components[i],10);
        if (!Array.isArray(obj) || isNaN(index) || (index.toString() !== components[i])) {
            index = (Array.isArray(obj) && components[i] === '-') ? -2 : -1;
        }
        else {
            components[i] = (i > 0) ? components[i-1] : ''; // backtrack to indexed property name
        }

        if ((index != -1) || obj.hasOwnProperty(components[i])) {
            if (index >= 0) {
                if (setAndLast) {
                    obj[index] = newValue;
                }
                obj = obj[index];
            }
            else if (index === -2) {
                if (setAndLast) {
                    if (Array.isArray(obj)) {
                        obj.push(newValue);
                    }
                    return newValue;
                }
                else return undefined;
            }
            else {
                if (setAndLast) {
                    obj[components[i]] = newValue;
                }
                obj = obj[components[i]];
            }
        }
        else {
            if ((typeof newValue !== 'undefined') && (typeof obj === 'object') &&
                (!Array.isArray(obj))) {
                obj[components[i]] = (setAndLast ? newValue : ((components[i+1] === '0' || components[i+1] === '-') ? [] : {}));
                obj = obj[components[i]];
            }
            else return false;
        }
    }
    return obj;
}

function defaultState() {
    return {
        path: '#',
        depth: 0,
        pkey: '',
        parent: {},
        payload: {},
        seen: new WeakMap(),
        identity: false,
        identityDetection: false
    };
}

/**
* recurses through the properties of an object, given an optional starting state
* anything you pass in state.payload is passed to the callback each time
* @param object the object to recurse through
* @param state optional starting state, can be set to null or {}
* @param callback the function which receives object,key,state on each property
*/
function recurse(object, state, callback) {
    if (!state) state = {depth:0};
    if (!state.depth) {
        state = Object.assign({},defaultState(),state);
    }
    if (typeof object !== 'object') return;
    let oPath = state.path;
    for (let key in object) {
        state.key = key;
        state.path = state.path + '/' + encodeURIComponent(jpescape(key));
        state.identityPath = state.seen.get(object[key]);
        state.identity = (typeof state.identityPath !== 'undefined');
        callback(object, key, state);
        if ((typeof object[key] === 'object') && (!state.identity)) {
            if (state.identityDetection && !Array.isArray(object[key]) && object[key] !== null) {
                state.seen.set(object[key],state.path);
            }
            let newState = {};
            newState.parent = object;
            newState.path = state.path;
            newState.depth = state.depth ? state.depth+1 : 1;
            newState.pkey = key;
            newState.payload = state.payload;
            newState.seen = state.seen;
            newState.identity = false;
            newState.identityDetection = state.identityDetection;
            recurse(object[key], newState, callback);
        }
        state.path = oPath;
    }
}

function dereference(o,definitions,options) {
    if (!options) options = {};
    if (!options.cache) options.cache = {};
    if (!options.state) options.state = {};
    options.state.identityDetection = true;
    // options.depth allows us to limit cloning to the first invocation
    options.depth = (options.depth ? options.depth+1 : 1);
    let obj = (options.depth > 1 ? o : clone(o));
    let container = { data: obj };
    let defs = (options.depth > 1 ? definitions : clone(definitions));
    // options.master is the top level object, regardless of depth
    if (!options.master) options.master = obj; 

    let changes = 1;
    while (changes > 0) {
        changes = 0;
        recurse(container,options.state,function(obj,key,state){
        if ((key === '$ref') && (typeof obj[key] === 'string')) {
            let $ref = obj[key]; // immutable
            changes++;
            if (!options.cache[$ref]) {
                let entry = {};
                entry.path = state.path.split('/$ref')[0];
                entry.key = $ref;
                //logger.warn('Dereffing %s at %s',$ref,entry.path);
                entry.source = defs;
                entry.data = jptr(entry.source,entry.key);
                if (entry.data === false) {
                    entry.data = jptr(options.master,entry.key);
                    entry.source = options.master;
                }
                options.cache[$ref] = entry;
                entry.data = state.parent[state.pkey] = dereference(jptr(entry.source,entry.key),entry.source,options);
                    if ((options.$ref) && (typeof state.parent[state.pkey] === 'object')) state.parent[state.pkey][options.$ref] = $ref;
                    //logger.warn(util.inspect(state.parent[state.pkey]));
                    entry.resolved = true;
                }
                else {
                    let entry = options.cache[$ref];
                    if (entry.resolved) {
                        // we have already seen and resolved this reference
                        //logger.warn('Patching %s for %s',$ref,entry.path);
                        state.parent[state.pkey] = entry.data;
                        if ((options.$ref) && (typeof state.parent[state.pkey] === 'object')) state.parent[state.pkey][options.$ref] = $ref;
                    }
                    else if ($ref === entry.path) {
                        // reference to itself, throw
                        throw new Error(`Tight circle at ${entry.path}`);
                    }
                    else {
                        // we're dealing with a circular reference here
                        //logger.warn('Unresolved ref');
                        //logger.warn(util.inspect(entry));
                        state.parent[state.pkey] = jptr(entry.source,entry.path);
                        if (state.parent[state.pkey] === false) {
                            state.parent[state.pkey] = jptr(entry.source,entry.key);
                        }
                        if ((options.$ref) && (typeof state.parent[state.pkey] === 'object')) state.parent[options.$ref] = $ref;
                    }
                }
            }
        });
    }
    return container.data;
}

function inferType(schema) {

    function has(properties) {
        for (let property of properties) {
            if (typeof schema[property] !== 'undefined') return true;
        }
        return false;
    }

    if (schema.type) return schema.type;
    let possibleTypes = [];
    if (has(['properties','additionalProperties','patternProperties','minProperties','maxProperties','required','dependencies'])) {
        possibleTypes.push('object');
    }
    if (has(['items','additionalItems','maxItems','minItems','uniqueItems'])) {
        possibleTypes.push('array');
    }
    if (has(['exclusiveMaximum','exclusiveMinimum','maximum','minimum','multipleOf'])) {
        possibleTypes.push('number'); 
    }
    if (has(['maxLength','minLength','pattern'])) {
        possibleTypes.push('number');
    }
    if (schema.enum) {
        for (let value of schema.enum) {
            possibleTypes.push(typeof value); // doesn't matter about dupes
        }
    }

    if (possibleTypes.length === 1) return possibleTypes[0];
    return 'any';
}

function getDefaultState() {
    return { depth: 0, seen: new WeakMap(), top: true, combine: false };
}

function walkSchema(schema, parent, state, callback) {

    if (typeof state.depth === 'undefined') state = getDefaultState();
    if (schema == null) return schema;
    if (typeof schema.$ref !== 'undefined') {
        let temp = {$ref:schema.$ref};
        callback(temp,parent,state);
        return temp; // all other properties SHALL be ignored
    }

    if (state.combine) {
        if (schema.allOf && Array.isArray(schema.allOf) && schema.allOf.length === 1) {
            schema = Object.assign({},schema.allOf[0],schema);
            delete schema.allOf;
        }
        if (schema.anyOf && Array.isArray(schema.anyOf) && schema.anyOf.length === 1) {
            schema = Object.assign({},schema.anyOf[0],schema);
            delete schema.anyOf;
        }
        if (schema.oneOf && Array.isArray(schema.oneOf) && schema.oneOf.length === 1) {
            schema = Object.assign({},schema.oneOf[0],schema);
            delete schema.oneOf;
        }
    }

    callback(schema,parent,state);
    if (state.seen.has(schema)) {
        return schema;
    }
    //else
    if ((typeof schema === 'object') && (schema !== null)) state.seen.set(schema,true);
    state.top = false;
    if(!schema.items) state.depth++;
    //state.depth++;

    if (typeof schema.items !== 'undefined') {
        state.property = 'items';
        walkSchema(schema.items,schema,state,callback);
    }
    if (schema.additionalItems) {
        if (typeof schema.additionalItems === 'object') {
            state.property = 'additionalItems';
            walkSchema(schema.additionalItems,schema,state,callback);
        }
    }
    if (schema.additionalProperties) {
        if (typeof schema.additionalProperties === 'object') {
            state.property = 'additionalProperties';
            walkSchema(schema.additionalProperties,schema,state,callback);
        }
    }
    if (schema.properties) {
        for (let prop in schema.properties) {
            let subSchema = schema.properties[prop];
            state.property = 'properties/'+prop;
            walkSchema(subSchema,schema,state,callback);
        }
    }
    if (schema.patternProperties) {
        for (let prop in schema.patternProperties) {
            let subSchema = schema.patternProperties[prop];
            state.property = 'patternProperties/'+prop;
            walkSchema(subSchema,schema,state,callback);
        }
    }
    if (schema.allOf) {
        for (let index in schema.allOf) {
            let subSchema = schema.allOf[index];
            state.property = 'allOf/'+index;
            walkSchema(subSchema,schema,state,callback);
        }
    }
    if (schema.anyOf) {
        for (let index in schema.anyOf) {
            let subSchema = schema.anyOf[index];
            state.property = 'anyOf/'+index;
            walkSchema(subSchema,schema,state,callback);
        }
    }
    if (schema.oneOf) {
        for (let index in schema.oneOf) {
            let subSchema = schema.oneOf[index];
            state.property = 'oneOf/'+index;
            walkSchema(subSchema,schema,state,callback);
        }
    }
    if (schema.not) {
        state.property = 'not';
        walkSchema(schema.not,schema,state,callback);
    }
    if(!schema.items) state.depth--;

    return schema;
}

function schemaToArray(schema,offset,options,data) {
    let iDepth = 0;
    let oDepth = 0;
    let blockDepth = 0;
    let container = [];
    let block = { title: '', rows: [] };
    container.push(block);
    let wsState = getDefaultState();
    wsState.combine = true;
    walkSchema(schema,{},wsState,function(schema,parent,state){

        let isBlock = false;
        if (state.property && (state.property.startsWith('allOf') || state.property.startsWith('anyOf') || state.property.startsWith('oneOf') || (state.property === 'not'))) {
            isBlock = true;
            let components = (state.property+'/0').split('/');
            if (components[1] !== '0') {
                if (components[0] === 'allOf') components[0] = 'and';
                if (components[0] === 'anyOf') components[0] = 'or';
                if (components[0] === 'oneOf') components[0] = 'xor';
            }
            block = { title: components[0], rows: [] };
            let dschema = schema;
            let prefix = '';
            if (schema.$ref) {
                dschema = jptr.jptr(data.api,schema.$ref);
                prefix = schema.$ref.replace('#/components/schemas/','')+'.';
            }
            if (dschema.discriminator) {
                block.title += ' - discriminator: '+prefix+dschema.discriminator.propertyName;
            }
            container.push(block);
            blockDepth = state.depth;
        }
        else {
            if (blockDepth && state.depth < blockDepth) {
                block = { title: 'test', rows: [] };
                container.push(block);
                blockDepth = 0;
            }
        }

        let entry = {};
        entry.schema = schema;
        entry.in = 'body';
        if (state.property && state.property.indexOf('/')) {
            if (isBlock) entry.name = '*'+'test'+'*'
            else entry.name = state.property.split('/')[1];
        }
        else if (!state.top) console.warn(state.property);
        if (!entry.name && schema.title) entry.name = schema.title;

        if (schema.type === 'array' && schema.items && schema.items["x-widdershins-oldRef"] && !entry.name) {
            state.top = false; // force it in
        }
        else if (schema.type === 'array' && schema.items && schema.items.$ref && !entry.name) {
            state.top = false; // force it in, for un-dereferenced schemas
        }
        else if (!entry.name && state.top && schema.type && schema.type !== 'object' && schema.type !== 'array') {
            state.top = false;
        }

        if (!state.top && !entry.name && state.property === 'additionalProperties') {
            entry.name = '**additionalProperties**';
        }
        if (!state.top && !entry.name && state.property === 'additionalItems') {
            entry.name = '**additionalItems**';
        }
        if (!state.top && !entry.name && state.property && state.property.startsWith('patternProperties')) {
            entry.name = '*'+entry.name+'*';
        }
        if (!state.top && !entry.name && !parent.items) {
            entry.name = '*'+'test'+'*';
        }

        // we should be done futzing with entry.name now

        if (entry.name) {
            if (state.depth > iDepth) {
                oDepth++;
            }
            if (state.depth < iDepth) {
                oDepth--;
                if (oDepth<0) oDepth=0;
            }
            iDepth = state.depth;
            //console.warn('state %s, idepth %s, odepth now %s, offset %s',state.depth,iDepth,oDepth,offset);
        }
        entry.depth = Math.max(state.depth, 0);
        //entry.depth = Math.max(oDepth+offset,0);
        //entry.depth = Math.max(oDepth-1,0)/2;
        //if (entry.depth<1) entry.depth = 0;

        entry.description = schema.description;
        if (options.trim && typeof entry.description === 'string') {
            entry.description = entry.description.trim();
        }
        if (options.join && typeof entry.description === 'string') {
            entry.description = entry.description.split('\r').join('').split('\n').join(' ');
        }
        if (options.truncate && typeof entry.description === 'string') {
            entry.description = entry.description.split('\r').join('').split('\n')[0];
        }
        if (entry.description === 'undefined') { // yes, the string
            entry.description = '';
        }
        entry.type = schema.type;
        entry.format = schema.format;

        entry.safeType = entry.type;

        if (schema["x-widdershins-oldRef"]) {
            entry.$ref = schema["x-widdershins-oldRef"].replace('#/components/schemas/','');
            entry.safeType = '['+entry.$ref+'](#schema'+entry.$ref.toLowerCase()+')';
        }
        if (schema.$ref) { // repeat for un-dereferenced schemas
            entry.$ref = schema.$ref.replace('#/components/schemas/','');
            entry.type = '$ref';
            entry.safeType = '['+entry.$ref+'](#schema'+entry.$ref.toLowerCase()+')';
        }

        if (entry.format) entry.safeType = entry.safeType+'('+entry.format+')';
        if ((entry.type === 'array') && schema.items) {
            let itemsType = schema.items.type||'any';
            //console.warn(util.inspect(schema));
            if (schema.items["x-widdershins-oldRef"]) {
                let $ref = schema.items["x-widdershins-oldRef"].replace('#/components/schemas/','');
                itemsType = '['+$ref+'](#schema'+$ref.toLowerCase()+')';
            }
            if (schema.items.$ref) { // repeat for un-dereferenced schemas
                let $ref = schema.items.$ref.replace('#/components/schemas/','');
                itemsType = '['+$ref+'](#schema'+$ref.toLowerCase()+')';
            }
            if (schema.items.anyOf) itemsType = 'anyOf';
            if (schema.items.allOf) itemsType = 'allOf';
            if (schema.items.oneOf) itemsType = 'oneOf';
            if (schema.items.not) itemsType = 'not';
            entry.safeType = '['+itemsType+']';
            //console.warn(entry.safeType);
        }

        entry.required = (parent.required && parent.required.indexOf(entry.name)>=0);
        if (typeof entry.required === 'undefined') entry.required = false;

        if (typeof entry.type === 'undefined') {
            entry.type = inferType(schema);
            entry.safeType = entry.type;
        }

        if (typeof entry.name === 'string' && entry.name.startsWith('x-widdershins-')) {
            entry.name = ''; // reset
        }
        entry.displayName = (' '+entry.name).trim();
        
        if ((!state.top || entry.type !== 'object') && (entry.name)) {
            block.rows.push(entry);
        }
    });
    return container;
}

function makeTOC(spec) {
        
    var resources = {}
    $.each(spec.paths, function(path, operations) {
        $.each(operations, function(method, options) {
            var api_method = {};
            api_method.operation = options;
            api_method.path = operations;
            api_method.verb = method;
            api_method.path = path;
            api_method.path_params = options.parameters;
            api_method.name = options.operationId;


            if(options.requestBody) {
                for(var rb in options.requestBody.content) {
                    api_method.content_type=rb;
                    api_method.requestBody = options.requestBody.content[rb].schema;
                    api_method.bodyParams = schemaToArray(api_method.requestBody,0,{trim:true},spec);
                }
            }
            var sphere_action = options.operationId.split('__');
            var tag_name = api_method.name;
            if(sphere_action.length == 2) {
                tag_name = sphere_action[0];
                api_method.sphere = sphere_action[0];
                api_method.action = sphere_action[1];             
            } else if (api_method.operation.tags && api_method.operation.tags.length > 0) {
                tag_name = api_method.operation.tags[0];
                api_method.sphere = tag_name;
                api_method.action= method;
            } else {
                tag_name = options.operationId;
                api_method.sphere = tag_name;
                api_method.action = method;
            }
                
            
            if(!resources[tag_name]) {
                resources[tag_name] = {};
            }
            if(!resources[tag_name].methods) resources[tag_name].methods = {};
            resources[tag_name].methods[api_method.action] = api_method;
        });
    });
    return resources;
}



/**
 * 
 *  Code my own
 */
function buildMenu(TOC, apis) {
    var sphere_options = [];

    //try to get a list of victims already in the db
    apis.default.victims__list().then( function(data) {
            
        if(data.body.victims) {            
            //parse victims and add to select
            var victim_options = [];
            $.each(data.body.victims, function(idx, victim) {
                victim_options.push('<option value="'+victim.id+'">' + victim.name + ' (' + victim.email + ')</option>');
            });
            $('select[id="victim-select"]').html( victim_options.join('') );
            $('select[id="victim-select"]').show();
        }
    },  function(reason) {
        console.error("failed to grab victims on reason" + reason);
    });

    //build out the different spheres this API provides
    $.each(TOC, function(sphere, methods) {
            
        sphere_options.push('<option value="'+ sphere + '">' + sphere + '</option>');
            
    });
    $('select[id="sphere-select"]').html( sphere_options.join(''));

    //changed the sphere actions select box whenever the selected sphere is changed
    $('select[id="sphere-select"]').change( function() {
        $('#queryParams').html('');
        $('#bodyParams').html('');
        var selected = $('select[id="sphere-select"] option:selected').text();

        var action_options;
        var param_options;
        action_options = [];
                
        //get the available operations (get, create, delete, etc) for the selected endpoint
        $.each(TOC[selected].methods, function(action, operation) {

            action_options.push('<option value="' + action + '">' + action + '</option>');
        });
        $('select[id="sphere-action-select"]').html( action_options.join(''));
        $('select[id="sphere-action-select"]').change();
    }).change();
}


function setTriggers(TOC, apis) {
        
    //dynamically generate inputs for api parameters
    $('select[id="sphere-action-select"]').change( function() {
        $("#queryParams").html('');
        $("#bodyParams").html('');

        var selected_sphere = $('select[id="sphere-select"] option:selected').text();

        var selected_sphere_action = $('select[id="sphere-action-select"] option:selected').attr('value');


        function buildInput(row) {
            var input = '';
            var label = '<div name="' + row.name + '" class="form-group" api-required="' + row.required + '" x-depth="' + row.depth + '"><label for="' + row.name + '">'+row.name+'</label>';
            var add_more = '';
            var html = label;

            if(row.safeType.includes("boolean")) {
                        
                input='<input x-depth="' + row.depth + '" api-required="' + row.required + '" class="api-field-input form-control" id="' + row.name + '" name="' + row.name + '" type="checkbox">';
                        
            } else if(row.schema.enum) {
                let choices = row.schema.enum;
                input = '<select x-depth="' + row.depth +   '" api-required="' + row.required + '" class="api-field-input  form-control" id="' + row.name + '" name="' + row.name + ' type="select">';
                for(let i=0; i < choices.length; i++) {
                    input += '<option value="' + choices[i] + '" >' + choices[i] + '</option>';
                }
                input += '</select>';
                        
            } else if(row.safeType.includes("string")) {
 
                let type = "text";
                if( row.format == "binary" || (row.schema.items && row.schema.items.format == "binary")) {
                    type = "file";
                } 
                        
                if(row.format == "textarea") {
                    input = '<textarea rows="10" cols="50" x-depth="' + row.depth + '" api-required="' + row.required + '" class="api-field-input  form-control" id="' + row.name + '" name="' + row.name + '" type="' + type + '"></textarea>';
                } else {
                        
                    input = '<input x-depth="' + row.depth + '" api-required="' + row.required + '" class="api-field-input  form-control" id="' + row.name + '" name="' + row.name + '" type="' + type + '">';
                }

            } else if(row.safeType.includes("number")) {
                input = '<input x-depth="' + row.depth + '" api-required="' + row.required + '" class="api-field-input  form-control" id="' + row.name + '" name="' + row.name + '" type="number" step="any">';
                    
            } else if(row.safeType.includes("integer")) {
                input = '<input x-depth="' + row.depth + '" api-required="' + row.required + '" class="api-field-input  form-control" id="' + row.name + '" name="' + row.name + '" type="number">';

            }
            html += input

            if(row.type == "array") {

  
                html += '<button id=add_"' + row.name + '" class="api-add-field" >add more</button></div>';
                           
            } else {
                html += '</div>';
            }
                                                     
            return html;

        }

        if(TOC[selected_sphere].methods[selected_sphere_action].path_params) {
            var html = '';
            var path_params = TOC[selected_sphere].methods[selected_sphere_action].path_params;

            $.each(path_params, function(idx, param) {
                if( param.name != "victim_id") {
                    html += '<div class="form-group"><label for="' + param.name + '" >' + param.name + '</label>';
                    html += '<input class="api-field-input form-control" id="' + param.name + '" name="' + param.name + '" type="text">';
                    html += '</div>';
                }
                        
            });

            $("#queryParams").html( html )
        }

        if(TOC[selected_sphere].methods[selected_sphere_action].bodyParams) {
                    
            function recurseInputs(html,  rows, prev_row) {
                var current_row;
                var prev_row;


                current_row = rows[recurseInputs.i];
                prev_row = prev_row ? prev_row : current_row;
                        


                if( current_row.type == "boolean" || current_row.type == "string" || current_row.type == "number" || current_row.type == "integer" || (current_row.type == "array" && current_row.safeType != "[object]") ) {
                    html += buildInput(current_row);
                            
                            
                } else {
                    html += '<div class="bodyParam" name="' + current_row.name + '" x-depth="' + current_row.depth + '" ' + ' type="' + current_row.type + '" >' + current_row.name;
                    recurseInputs.i++;
                    html = recurseInputs(html, rows, current_row);
                    if( current_row.type == "array" ) {
                        html += '<button id=add_' + current_row.name + ' class="api-add-field" >add more</button>';
                    }

                    html += '</div>';
                }
                
                if(recurseInputs.i+1 < rows.length - 1 && current_row.depth == rows[recurseInputs.i+1].depth) {
                    recurseInputs.i++;
                    html = recurseInputs(html, rows, prev_row);
                }

                return html;
            }
            recurseInputs.i = 0;


            var request_body_params = TOC[selected_sphere].methods[selected_sphere_action].bodyParams;

                    
            function fix_arrays(selector) {
                        
                $this = $(selector);
                        
                $.each( $this.find('div[type="array"]'), function( indx, elem ) {
                    let $elem = $(elem);

                    let $array_elem = $('<div></div>');
                    let depth = 0;
                    $array_elem.addClass("form-array-elem");
                    $.each( $elem.children('div'), function(key, value) {
                        depth = $(value).attr('x-depth');
                        $array_elem.append( $(value).clone() );
                        $(value).remove();
                    });
                    $array_elem.attr('x-depth', depth);
                    let $add = $elem.children('.api-add-field');
                    $add.before($array_elem );
                });
            }

            for(group in request_body_params) {

                var depth_map = {};

                var $html = $('<div></div>');
                var curr = $html;
                var prev = $html;
                var depth =1;
                var prev_depth = 1;
                depth_map[ depth ] = curr;
                var rows = request_body_params[group].rows;

                        
                for(i = 0; i < rows.length; i++) {
                    var current_row = rows[i];
                    if( current_row.type == "boolean" || current_row.type == "string" || current_row.type == "number" || current_row.type == "integer" || (current_row.type == "array" && current_row.safeType != "[object]") ) {
                        if( current_row.depth < depth) {
                            let temp = curr;

                            prev = temp;
                            prev_depth = depth;
                            depth = current_row.depth;
                            curr = depth_map[ depth ];
                        } else if( current_row.depth > depth ) {
                            prev_depth = depth;
                            depth = current_row.depth;
                            depth_map[ depth ] = curr;
                        }
                        curr.append( buildInput(current_row) );
                    } else {
                        if( current_row.depth < depth ) {
                                    
                            prev_depth = depth;
                            depth = current_row.depth;
                            curr = depth_map[ depth ];
                        }
                        var temp =  $('<div class="bodyParam" name="' + current_row.name + '" x-depth="' + current_row.depth + '" ' + ' type="' + current_row.type + '" >' + current_row.name + '</div>' );
                        curr.append( temp );
                        prev = curr;
                        curr = temp;
                        if( current_row.type == "array") {
                            curr.append( '<button id=add_' + current_row.name + ' class="api-add-field" >add more</button>');
                        }
                        if( current_row.depth > depth ) {

                            prev_depth = depth;
                            depth = current_row.depth;

                            depth_map[ depth ] = curr;
                        }
                    }
                                
                }
                        
                        
                $("#bodyParams").html( $html );
                fix_arrays("#bodyParams");
            }
        }

    }).change();

            
    $("#fields").on("click", ".api-add-field", function( event ) {

        var $elem = $(this);
        if ($elem.siblings(".form-array-elem").length > 0) {

            let $array_elem = $($elem.siblings(".form-array-elem")[0]);
            let $copy = $array_elem.clone();
            $elem.before( $copy );
        } else {

            var $input = $($elem.siblings(".api-field-input")[0]);
            $input.after( $input.clone() );
        }
                

                
    });
}

function parseSpec(apis, spec) {
        
    if(data.components) {
        data.components = JSON.parse(JSON.stringify(data.components));
     } else {
        data.components = {};
    }
    data.spec = dereference(spec,spec,{$ref:'x-widdershins-oldRef'});

    data.api = apis;

    api = apis;
    TOC = makeTOC(data.spec);

    buildMenu(TOC, apis);
    setTriggers(TOC, apis);
           
}
