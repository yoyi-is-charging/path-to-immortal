// websocket-client.js

import { eventBus } from "./event-bus.js";

const baseDelay = 2000;
const maxAttempts = 5;
const autoReconnect = true;

export class WebSocketClient {
    constructor() {
        this.websocket = null;
        this.pendingRequests = new Map();

        this.attempts = 0;
        this.reconnectTimer = null;
        this.manualClose = false;

        this.connect();
    }

    async request(data) {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not open. Unable to send message.');
        }

        const requestId = generateUUID();
        const requestData = { ...data, requestId };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });
            this.websocket.send(JSON.stringify(requestData));
        });
    }

    handleMessage(event) {
        const message = JSON.parse(event.data);
        if (message.type === 'response')
            this.handleResponse(message);
        if (message.type === 'broadcast')
            eventBus.emit(message.event, message.payload);
    }

    handleResponse(message) {
        const { requestId, success, payload } = message;
        const { resolve, reject } = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        if (success)
            resolve(payload);
        else
            reject(new Error(`Request failed: ${JSON.stringify(payload)}`));
    }

    /** @type {(data: any) => void} */
    onMessage = null;

    connect() {
        if (this.websocket) return;
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        this.websocket = new WebSocket(`${protocol}://${window.location.host}/ws`);
        this.setupEventListeners();
    }


    setupEventListeners() {
        this.websocket.onopen = () => {
            this.attempts = 0;
            eventBus.emit('websocketConnected');
        };
        this.websocket.onmessage = this.handleMessage.bind(this);
        this.websocket.onclose = this.handleClose.bind(this);
    }

    /**
     * 处理连接关闭
     * @param {CloseEvent} event
     * @private
     */
    handleClose(event) {
        console.log(`connect closed: ${event.code} ${event.reason}`);
        if (this.manualClose) return;
        if (this.attempts < maxAttempts)
            this.scheduleReconnect();
        else
            console.error(`connect failed after ${this.attempts} attempts`);
    }

    scheduleReconnect() {
        const delay = baseDelay * Math.pow(2, this.attempts);
        this.attempts++;
        console.log(`Reconnecting in ${delay}ms...`);
        if (autoReconnect)
            this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }

    close(code = 1000, reason = '') {
        this.manualClose = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        if (this.websocket) {
            this.websocket.close(code, reason);
            this.websocket = null;
        }
    }

    get status() {
        return this.websocket?.readyState ? ['connecting', 'open', 'closing', 'closed'][this.websocket.readyState - 1] : 'closed';
    }

    destroy() {
        this.close();
        this.onMessage = null;
    }
}

export const wsClient = new WebSocketClient();

function generateUUID() {
    if (window.crypto?.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older browsers
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}