import tv4 from 'tv4';

tv4.addFormat('date-time', (data) => {
    if (typeof data === 'string') {
        data = new Date(data);
    }
    if ((data instanceof Date) && !isNaN(data.getTime())) {
        return null;
    }
    return 'Invalid date';
});

function isObject(val) {
    return val !== null && val !== undefined && typeof val === 'object';
}

/**
 * Clone javascript objects.
 * @private
 *
 * @param {Object|Array} obj The object to clone.
 * @param {Function} callback An optional function which runs before inserting a property.
 * @return {Object|Array} The clone of the object.
 */
function clone(obj, callback) {
    callback = callback || function(scope, key, prop) { return prop; };
    if (Array.isArray(obj)) {
        return obj.map((entry, index) => {
            entry = callback(obj, index, entry);
            if (isObject(entry)) {
                return clone(entry, callback);
            }
            return entry;
        });
    } else if (obj instanceof Date) {
        return new Date(obj);
    }
    let res = {};
    Object.keys(obj).forEach((k) => {
        let val = callback(obj, k, obj[k]);
        if (isObject(val)) {
            res[k] = clone(val, callback);
        } else {
            res[k] = val;
        }
    });
    return res;
}
/**
 * Merge two objects in a new one.
 * @private
 *
 * @param {Object} obj1 The initial object.
 * @param {Object} obj2 The object to merge.
 * @return {Object} The merged object.
 */
function merge(obj1, obj2) {
    let res = clone(obj1);
    Object.keys(obj2).forEach((key) => {
        if (isObject(obj2[key])) {
            if (isObject(res[key])) {
                res[key] = merge(res[key], obj2[key]);
            } else {
                res[key] = obj2[key];
            }
        } else {
            res[key] = obj2[key];
        }
    });
    return res;
}
/**
 * Get data from an object.
 * @private
 *
 * @param {Object} scope The object to use.
 * @param {String} k The data key.
 * @param {Boolean} internal Should get value has private property.
 * @return {any} The value of the object for the given key.
 */
function get(scope, k, internal) {
    if (internal) {
        k = getSymbol(k);
    }
    return scope[k];
}
/**
 * Merge data to another object.
 * @private
 *
 * @param {Object} scope The object to update.
 * @param {Object} data The object to merge.
 * @param {Boolean} internal Should set value has private property.
 */
function set(scope, data, internal) {
    Object.keys(data).forEach((k) => {
        let ok = k;
        if (internal) {
            k = getSymbol(k);
        }
        if (scope[k] !== data[ok]) {
            scope[k] = data[ok];
        }
    });
}
/**
 * Create a private symbol.
 * @private
 *
 * @param {String} name The name of the property to privatize.
 * @return {Symbol|String}
 */
function getSymbol(name) {
    if (!getSymbol.cache[name]) {
        if (typeof Symbol !== 'undefined') {
            getSymbol.cache[name] = Symbol(name);
        } else {
            getSymbol.cache[name] = `__${name}`;
        }
    }
    return getSymbol.cache[name];
}

getSymbol.cache = {};
/**
 * Get all root properties merging definition.
 * @private
 *
 * @param {Object} schema The schema to analyze.
 * @param {Object} validator The validator instance.
 * @return {Object} A list of properties.
 */
function getProperties(schema, validator) {
    let root = !validator;
    if (root) {
        validator = tv4.freshApi();
        validator.addSchema('', schema);
    }
    if (schema.definitions) {
        for (let k in schema.definitions) {
            validator.addSchema(`#/definitions/${k}`, schema.definitions[k]);
        }
    }
    if (schema.$ref) {
        schema = validator.getSchema(schema.$ref);
    }
    if (schema.properties) {
        return clone(schema.properties);
    }
    let res = {};
    let defs = schema['anyOf'] || schema['allOf'] || (root && schema['oneOf']);
    if (defs) {
        defs.forEach((def) => {
            res = merge(res, getProperties(def, validator));
        });
    }
    return res;
}

const DEFAULT_OPTIONS = {
    validate: true,
    internal: false,
};

export class SchemaModel {
    /**
     * Merge two objects in a new one.
     *
     * @param {Object} obj1 The initial object.
     * @param {Object} obj2 The object to merge.
     * @return {Object} The merged object.
     */
    static merge(...args) {
        return merge(...args);
    }
    /**
     * Clone javascript objects.
     *
     * @param {Object|Array} obj The object to clone.
     * @param {Function} callback An optional function which runs before inserting a property.
     * @return {Object|Array} The clone of the object.
     */
    static clone(...args) {
        return clone(...args);
    }
    /**
     * Create a new schema class extending SchemaModel.
     *
     * @param {Object} schema The schema to use for the new model class.
     * @return {class} An extended SchemaModel.
     */
    static create(schema) {
        return class extends SchemaModel {
            static get schema() {
                return schema;
            }
        };
    }
    /**
     * The schema of the model.
     * @type {Object}
     * @memberof SchemaModel
     */
    static get schema() {
        throw new Error('Missing schema');
    }
    /**
     * The schema merged properties.
     * @type {Object}
     * @memberof SchemaModel
     */
    static get schemaProperties() {
        return getProperties(this.schema);
    }
    /**
     * Generate Model classes based on JSON Schema definition.
     * @class
     *
     * @param {Object} data The (optional) initial data to set.
     * @param {Object} options Optional options for data setting.
     */
    constructor(data, options) {
        if (data) {
            this.set(data, options);
        }
    }
    /**
     * Get a property value.
     *
     * @param {String} name The property name to retrieve.
     * @param {Object} options Optional options for data getting.
     * @return {any} The property value.
     */
    get(name, options) {
        options = merge(DEFAULT_OPTIONS, options || {});
        return get(this, name, options.internal);
    }
    /**
     * Set a bunch of properties.
     *
     * @param {Object} data The data to set.
     * @param {Object} options Optional options for data setting.
     */
    set(data, value, options) {
        if (typeof data === 'string') {
            return this.set({
                [data]: value,
            }, options);
        }
        data = data || {};
        options = merge(DEFAULT_OPTIONS, value || {});
        if (!options.internal && options.validate) {
            let dataToValidate = merge(this.toJSON(true), data);
            let res = this.validate(dataToValidate, options);
            /* istanbul ignore if */
            if (!res.valid) {
                if (res.error && res.error.message) {
                    throw new Error(res.error.message);
                } else if (res.missing.length) {
                    throw new Error(`Missing $ref schemas: ${res.missing.join(', ')}`);
                }
                throw new Error('Validation failed');
            }
        }
        set(this, data, options.internal);
    }
    /**
     * Validate a bunch of data or the model instance.
     *
     * @param {Object} data Optional data to validate (if empty, use model's data).
     * @return {Object} A validation result.
     */
    validate(data) {
        data = data || this.toJSON(true);
        let schema = this.constructor.schema;
        let res = tv4.validateResult(data, schema);
        /* istanbul ignore if  */
        if (res.valid && res.missing.length) {
            res.valid = false;
        }
        return res;
    }
    /**
     * Convert the model to a plain javascript object.
     *
     * @param {Boolean} stripUndefined Strip undefined values from model.
     * @return {Object} A representation of the model as plain object.
     */
    toJSON(stripUndefined) {
        let keys = Object.keys(this.constructor.schemaProperties);
        let res = {};
        keys.forEach((key) => {
            let val = this.get(key);
            if (!stripUndefined || val !== undefined) {
                res[key] = val;
            }
        });
        res = clone(res, (scope, key, prop) => {
            if (prop instanceof SchemaModel) {
                return prop.toJSON(stripUndefined);
            }
            return prop;
        });
        return res;
    }
}

SchemaModel.symbols = {};
