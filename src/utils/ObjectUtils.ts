// src/utils/ObjectUtils.ts

export function merge<T extends Record<string, any>>(target: T, source: T): T {
    if (!target) return source;
    for (const key in source) {
        const value = source[key];
        if (value && value.constructor === Object)
            target[key] = merge(target[key], value);
        else
            target[key] = value;
    }
    return target;
}