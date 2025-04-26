// src/public/components/event-bus.js

class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(event, callback) {
        const listeners = this.listeners.get(event) || [];
        listeners.push(callback);
        this.listeners.set(event, listeners);
    }

    emit(event, data) {
        const listeners = this.listeners.get(event) || [];
        listeners.forEach(callback => callback(data));
    }
}

export const eventBus = new EventBus();
window.eventBus = eventBus;

// eventBus.on('statusUpdated', (data) => console.log('Status Updated:', data));
// eventBus.on('accountLoaded', (data) => console.log('Account Loaded:', data));
// eventBus.on('commandsUpdated', (data) => console.log('Commands Updated:', data));
eventBus.on('websocketConnected', () => console.log('WebSocket Connected'));