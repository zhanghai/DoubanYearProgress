'use strict';

const moment = require('moment-timezone');
const request = require('request');
const schedule = require('node-schedule');

const config = require('./config.js');

const userAgent = `api-client/2.0 com.douban.shuo/2.2.7(123) Android/${config.api.device.sdkInt} `
    + `${config.api.device.product} ${config.api.device.manufacturer} ${config.api.device.model}`;

let accessToken = null;

function authenticate(callback) {
    request.post({
        url: 'https://www.douban.com/service/auth2/token',
        encoding: 'utf8',
        headers: {
            'User-Agent': userAgent
        },
        form: {
            client_id: config.api.key,
            client_secret: config.api.secret,
            redirect_uri: 'http://shuo.douban.com/!service/android',
            grant_type: 'password',
            username: config.username,
            password: config.password
        },
        json: true
    }, (error, response, body) => {
        if (error) {
            console.error(error);
            return;
        }
        if (!body.access_token) {
            console.error(body);
            return;
        }
        console.log(body);
        accessToken = body.access_token;
        if (typeof callback === 'function') {
            callback();
        }
    });
}

function sendBroadcast(text, callback) {
    request.post({
        url: 'https://api.douban.com/v2/lifestream/statuses',
        encoding: 'utf8',
        headers: {
            'User-Agent': userAgent,
            'Authorization': `Bearer ${accessToken}`
        },
        form: {
            version: 2,
            text: text,
        },
        json: true,
    }, (error, response, body) => {
        if (error) {
            console.error(error);
            switch (error.code) {
                case 103: // INVALID_ACCESS_TOKEN
                case 106: // ACCESS_TOKEN_HAS_EXPIRED
                case 119: // INVALID_REFRESH_TOKEN
                case 123: // ACCESS_TOKEN_HAS_EXPIRED_SINCE_PASSWORD_CHANGED
                    authenticate(() => sendBroadcast(text));
            }
            return;
        }
        console.log(body);
        if (typeof callback === 'function') {
            callback();
        }
    });
}

function generateText () {
    const now = moment().tz('Asia/Shanghai');
    const yearStart = moment(now).startOf('year');
    const yearEnd = moment(yearStart).add(1, 'year');
    const progress = Math.round(1000 * now.diff(yearStart) / yearEnd.diff(yearStart)) / 10;
    let text = '';
    for (let i = 5; i <= 100; i += 5) {
        text += i <= progress ? '▓' : '░';
    }
    text += ` ${progress}%`;
    text += ` #${now.get('year')}#`;
    return text;
}

function run() {

    if (!accessToken) {
        authenticate(run);
        return;
    }

    sendBroadcast('Hello, Douban!');

    schedule.scheduleJob({
        hour: 10,
        minute: 0
    }, () => sendBroadcast(generateText()));
}

run();
