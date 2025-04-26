// src/public/components/notification.js

import { eventBus } from './event-bus.js';

class NotificationManager {
    constructor() {
        if (Notification.permission !== 'granted')
            Notification.requestPermission();
        this.lastNotificationTime = 0;
        eventBus.on('statusUpdated', this.checkWoodPrice.bind(this));
    }

    createNotification(title, message) {
        if (Date.now() - this.lastNotificationTime < 15000) return;
        const notification = new Notification(title, { body: message });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
        this.lastNotificationTime = Date.now();
    }

    checkWoodPrice(account) {
        if (account?.status?.wooding?.price >= account?.config?.wooding?.minPrice)
            this.createNotification('木头价格', `账号 ${account?.id} 的木头价格为 ${account?.status?.wooding?.price}`);

    }
}

export const notificationManager = new NotificationManager();
