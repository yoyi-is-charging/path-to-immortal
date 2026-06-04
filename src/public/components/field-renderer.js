// src/public/components/field-renderer.js

export class FieldRenderer {

    static render(schema, value, path = '') {
        schema = this.normalizeSchema(schema);
        switch (schema.type) {
            case 'boolean':
                return this.renderBoolean(schema, value, path);
            case 'string':
            case 'number':
                return schema.enum ? this.renderEnum(schema, value, path) : this.renderText(schema, value, path);
            case 'array':
                return this.renderArray(schema, value, path);
            case 'object':
                const isTimeObject = Object.keys(schema.properties).every(key => ['hours', 'minutes', 'seconds'].includes(key));
                if (isTimeObject)
                    return this.renderTimeObject(schema, value, path);
                else
                    return this.renderObject(schema, value, path);
        }
        return '';
    }

    static parse(schema, node, path = '', filter = null) {
        schema = this.normalizeSchema(schema);
        if (!node)
            return undefined;
        switch (schema.type) {
            case 'boolean':
                return Boolean(node.selected);
            case 'string':
                return node.value || undefined;
            case 'number':
                if (node.value === '')
                    return undefined;
                const value = Number(node.value);
                return Number.isFinite(value) ? value : undefined;
            case 'array':
                if (!node.value?.trim())
                    return [];
                if (schema.items.type === 'string')
                    return node.value.split(',').map(item => item.trim()).filter(Boolean);
                if (schema.items.type === 'number')
                    return node.value.split(',').map(item => Number(item.trim())).filter(Number.isFinite);
            case 'object':
                return Object.entries(schema.properties).reduce((result, [key, subSchema]) => {
                    const itemPath = `${path}${path ? '.' : ''}${key}`;
                    if (!filter || filter(itemPath))
                        result[key] = this.parse(subSchema, node.querySelector(`#${this.getId(itemPath)}`), itemPath, filter);
                    return result;
                }, {});

        }
    }

    static renderBoolean(schema, value, path) {
        return `<label>${this.escape(schema.description)}<md-switch id="${this.getId(path)}" class="field boolean"${value ? ' selected' : ''}></md-switch></label>`
    }

    static renderText(schema, value, path) {
        if (schema.format === 'date-time') {
            const dateValue = value ? new Date(value) : null;
            const displayValue = dateValue && !Number.isNaN(dateValue.getTime()) ? dateValue.toISOString() : '';
            return `<label>${this.escape(schema.description)}<md-outlined-text-field id="${this.getId(path)}" class="field date" type="text" value="${this.escapeAttr(displayValue)}"></md-outlined-text-field></label>`;
        }
        const type = schema.type === 'string' ? 'text' : 'number';
        return `<label>${this.escape(schema.description)}<md-outlined-text-field id="${this.getId(path)}" class="field ${type}" type="${type}" value="${this.escapeAttr(value ?? '')}"></md-outlined-text-field></label>`
    }

    static renderTimeObject(schema, value, path) {
        const time = value || {};
        return `<label id="${this.getId(path)}" class="schema-time">${this.escape(schema.description)} 
            <div class="field time">
            <md-outlined-text-field id="${this.getId(path)}-hours" class="field hours" type="number" value="${this.escapeAttr(time.hours ?? '')}"></md-outlined-text-field>
            :
            <md-outlined-text-field id="${this.getId(path)}-minutes" class="field minutes" type="number" value="${this.escapeAttr(time.minutes ?? '')}"></md-outlined-text-field>
            :
            <md-outlined-text-field id="${this.getId(path)}-seconds" class="field seconds" type="number" value="${this.escapeAttr(time.seconds ?? '')}"></md-outlined-text-field>
            </div>
        </label>`;
    }

    static renderEnum(schema, value, path) {
        const type = schema.type === 'string' ? 'text' : 'number';
        const options = schema.enum.map(option => `<md-select-option value="${this.escapeAttr(option)}"${option === value ? ' selected' : ''}><div slot="headline">${this.escape(option)}</div></md-select-option>`).join('');
        return `<label>${this.escape(schema.description)}<md-outlined-select id="${this.getId(path)}" class="field enum ${type}" value="${this.escapeAttr(value ?? '')}">${options}</md-outlined-select></label>`
    }

    static renderArray(schema, value, path) {
        const type = schema.items.type === 'string' ? 'text' : 'number';
        const textValue = Array.isArray(value) ? value.join(', ') : '';
        return `<label>${this.escape(schema.description)}<md-outlined-text-field id="${this.getId(path)}" class="field array ${type}" type="text" value="${this.escapeAttr(textValue)}"></md-outlined-text-field></label>`
    }

    static renderObject(schema, value, path) {
        const properties = Object.entries(schema.properties);
        const content = properties.map(([key, subSchema], index) => {
            const itemPath = `${path}${path ? '.' : ''}${key}`;
            const normalizedSubSchema = this.normalizeSchema(subSchema);
            const itemResult = this.render(normalizedSubSchema, value?.[key], itemPath);
            const isObject = normalizedSubSchema.type === 'object';
            const item = isObject
                ? itemResult
                : `<div class="schema-row">${itemResult}</div>`;
            const isLastItem = index === properties.length - 1;
            return isLastItem || isObject ? item : `${item}<div class="schema-divider"></div>`;
        }).join('');
        const id = path ? ` id="${this.getId(path)}"` : '';
        const header = path && schema.description
            ? `<summary class="schema-section-header">${this.escape(schema.description)}</summary>`
            : '';
        const tagName = path ? 'details' : 'div';
        return `
        <${tagName}${id} class="schema-section" data-schema-path="${this.escapeAttr(path)}">
            ${header}
            <div class="schema-section-body">${content}</div>
        </${tagName}>
        `
    }

    static getId(path) {
        return path.replace(/\./g, '-');
    }

    static normalizeSchema(schema) {
        if (!schema)
            return {};
        const union = schema.anyOf || schema.oneOf;
        if (union?.length) {
            const literalValues = union
                .map(item => item.const)
                .filter(value => value !== undefined);
            if (literalValues.length === union.length)
                return {
                    ...schema,
                    type: typeof literalValues[0],
                    enum: literalValues,
                    anyOf: undefined,
                    oneOf: undefined,
                };
        }
        return schema;
    }

    static escape(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    static escapeAttr(value) {
        return this.escape(value);
    }
}
