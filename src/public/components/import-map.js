// components/import-map.js
const IMPORT_MAP = { imports: { "tslib": "/node_modules/tslib/tslib.es6.js", "lit/": "/node_modules/lit/", "lit": "/node_modules/lit/index.js", "@lit/reactive-element": "/node_modules/@lit/reactive-element/reactive-element.js", "@lit/reactive-element/": "/node_modules/@lit/reactive-element/", "lit-html": "/node_modules/lit-html/lit-html.js", "lit-html/": "/node_modules/lit-html/", "lit-element/": "/node_modules/lit-element/" } };

class ImportMap extends HTMLElement {
    connectedCallback() {
        const script = document.createElement('script')
        script.type = 'importmap'
        script.textContent = JSON.stringify(IMPORT_MAP)
        this.replaceWith(script)
    }
}

customElements.define('import-map', ImportMap)