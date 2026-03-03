// src/public/components/field-renderer.js

export class FieldRenderer {

    static render(schema, value, path = '') {
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
    }

    static parse(schema, node, path = '', filter = null) {
        switch (schema.type) {
            case 'boolean':
                return node.selected;
            case 'string':
                return node.value;
            case 'number':
                return parseInt(node.value);
            case 'array':
                if (schema.items.type === 'string')
                    return node.value.split(',').map(item => item.trim());
                if (schema.items.type === 'number')
                    return node.value.split(',').map(item => parseInt(item.trim()));
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
        return `<label>${schema.description}<md-switch id="${this.getId(path)}" class="field boolean"${value ? ' selected' : ''}></md-switch></label>`
    }

    static renderText(schema, value, path) {
        if (schema.format === 'date-time')
            return `<label>${schema.description}<md-filled-text-field id="${this.getId(path)}" class="field date" type="string" value="${new Date(value).toLocaleTimeString()}"></md-filled-text-field></label>`;
        const type = schema.type === 'string' ? 'text' : 'number';
        return `<label>${schema.description}<md-filled-text-field id=${this.getId(path)} class="field ${type}" type="${type}" value="${value}"></md-filled-text-field></label>`
    }

    static renderTimeObject(schema, value, path) {
        return `<label id="${this.getId(path)}" class="section time">${schema.description} 
            <div class="field time">
            <md-filled-text-field id="${this.getId(path)}-hours" class="field hours" type="number" value="${value.hours}"></md-filled-text-field>
            :
            <md-filled-text-field id="${this.getId(path)}-minutes" class="field minutes" type="number" value="${value.minutes}"></md-filled-text-field>
            :
            <md-filled-text-field id="${this.getId(path)}-seconds" class="field seconds" type="number" value="${value.seconds}"></md-filled-text-field>
            </div>
        </label>`;
    }

    static renderEnum(schema, value, path) {
        const type = schema.type === 'string' ? 'text' : 'number';
        const options = schema.enum.map(option => `<md-select-option value="${option}"${option === value ? ' selected' : ''}><div slot="headline">${option}</div></md-select-option>`).join('');
        return `<label>${schema.description}<md-filled-select id="${this.getId(path)}" class="field enum ${type}" value="${value}">${options}</md-filled-select></label>`
    }

    static renderArray(schema, value, path) {
        const type = schema.items.type === 'string' ? 'text' : 'number';
        return `<label>${schema.description}<md-filled-text-field id="${this.getId(path)}" class="field array ${type}" type="text" value="${value}"></md-filled-text-field></label>`
    }

    static renderObject(schema, value, path) {
        const properties = Object.entries(schema.properties);
        const content = properties.map(([key, subSchema], index) => {
            const itemPath = `${path}${path ? '.' : ''}${key}`;
            const itemResult = this.render(subSchema, value?.[key], itemPath);
            const item = `<md-list-item>${itemResult}</md-list-item>`;
            const isLastItem = index === properties.length - 1;
            const isObject = subSchema.type === 'object';
            return isLastItem || isObject ? item : `${item}<md-divider></md-divider>`;
        }).join('');
        return `
        <div id="${this.getId(path)}" class="section">
            <div class="section-header">${schema.description}</div>
            <md-list class="section-content">${content}</md-list>
        </div>
        `
    }

    static getId(path) {
        return path.replace(/\./g, '-');
    }
}