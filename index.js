'use strict';

require('util.promisify').shim();

const fs = require('fs');
const util = require('util');

const ICal = require('ical.js');
const moment = require('moment-timezone');
const Request = require('request-promise-native');
const Schedule = require('node-schedule');

const config = require('./config.js');

const timezone = 'Asia/Shanghai';

const userAgent = `api-client/2.0 com.douban.shuo/2.2.7(123) Android/${config.api.device.sdkInt} `
        + `${config.api.device.product} ${config.api.device.manufacturer} ${config.api.device.model}`;

let accessToken = null;

async function authenticate() {
    const body = await Request.post({
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
    });
    if (!body.access_token) {
        throw body;
    }
    console.log(body);
    accessToken = body.access_token;
}

async function sendBroadcast(text) {
    try {
        const body = await Request.post({
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
        });
        console.log(body);
    } catch (error) {
        switch (error.code) {
            case 103: // INVALID_ACCESS_TOKEN
            case 106: // ACCESS_TOKEN_HAS_EXPIRED
            case 119: // INVALID_REFRESH_TOKEN
            case 123: // ACCESS_TOKEN_HAS_EXPIRED_SINCE_PASSWORD_CHANGED
                await authenticate();
                await sendBroadcast(text);
                break;
            default:
                throw error;
        }
    }
}

const readFile = util.promisify(fs.readFile);
let holidaysCache = null;
async function getHolidays() {
    if (!holidaysCache) {
        const iCalData = await readFile('china__zh_cn@holiday.calendar.google.com.ics', 'utf8');
        const iCalComponent = new ICal.Component(ICal.parse(iCalData));
        const events = iCalComponent.getAllSubcomponents('vevent').map(vevent => new ICal.Event(vevent));
        holidaysCache = events.map(event => ({
            name: event.summary,
            start: moment(event.startDate.toString()).tz(timezone),
            end: moment(event.endDate.toString()).tz(timezone)
        }));
    }
    return holidaysCache;
}

async function getHolidayNamesForTime(time) {
    const holidays = await getHolidays();
    const holidayNames = [];
    for (const holiday of holidays) {
        if (time.isSameOrAfter(holiday.start) && time.isBefore(holiday.end)) {
            holidayNames.push(holiday.name);
        }
    }
    return holidayNames;
}

async function generateText() {
    const now = moment().tz(timezone);
    const yearStart = moment(now).startOf('year');
    const yearEnd = moment(yearStart).add(1, 'year');
    const progress = Math.round(1000 * now.diff(yearStart) / yearEnd.diff(yearStart)) / 10;
    let text = '';
    for (let i = 5; i <= 100; i += 5) {
        text += i <= progress ? '▓' : '░';
    }
    text += ` ${progress}%`;
    text += ` #${now.get('year')}#`;
    for (const holidayName of await getHolidayNamesForTime(now)) {
        text += ` #${holidayName}#`;
    }
    return text;
}

async function run() {

    await authenticate();

    await sendBroadcast('Hello, Douban!');

    Schedule.scheduleJob({
        hour: 10,
        minute: 0
    }, async () => await sendBroadcast(await generateText()));
}

run();
