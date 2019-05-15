'use strict';

require('util.promisify').shim();

const crypto = require('crypto');
const fs = require('fs');
const util = require('util');

const CalendarChinese = require('date-chinese').CalendarChinese;
const ICal = require('ical.js');
const moment = require('moment-timezone');
const Request = require('request-promise-native');
const Schedule = require('node-schedule');

const config = require('./config.js');

const timezone = 'Asia/Shanghai';

const userAgent = `api-client/1 com.douban.frodo/6.0.1(138) Android/${config.api.device.sdkInt} product/${
        config.api.device.product} vendor/${config.api.device.manufacturer} model/${config.api.device.model
        }  rom/android  network/wifi`;

let accessToken = null;

const FrodoRequest = Request.defaults(params => {
    let signature = params.method;
    const path = new URL(params.url).pathname;
    const signaturePath = encodeURIComponent(decodeURIComponent(path).replace(/\/$/, ''));
    signature += `&${signaturePath}`;
    if (params.headers && params.headers.Authorization) {
        const signatureAuthToken = params.headers.Authorization.substring(7);
        signature += `&${signatureAuthToken}`;
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    signature += `&${timestamp}`;
    signature = crypto.createHmac('sha1', config.api.secret).update(signature).digest('base64');
    switch (params.method) {
        case "PATCH":
        case "POST":
        case "PROPPATCH":
        case "PUT":
        case "REPORT":
            if (params.formData) {
                params.formData._sig = signature;
                params.formData._ts = timestamp;
            } else {
                if (!params.form) {
                    params.form = {};
                }
                params.form._sig = signature;
                params.form._ts = timestamp;
            }
            break;
        default: {
            const url = new URL(params.url);
            url.searchParams.append('_sig', signature);
            url.searchParams.append('_ts', timestamp);
            params.url = url.href;
        }
    }
    return Request(params);
});

/**
 * @return {Promise.<void>}
 */
async function authenticate() {
    const body = await FrodoRequest.post({
        url: 'https://frodo.douban.com/service/auth2/token',
        encoding: 'utf8',
        headers: {
            'User-Agent': userAgent
        },
        form: {
            client_id: config.api.key,
            client_secret: config.api.secret,
            redirect_uri: 'frodo://app/oauth/callback/',
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

/**
 * @param {string} text
 * @return {Promise.<void>}
 */
async function sendBroadcast(text) {
    try {
        const body = await FrodoRequest.post({
            url: 'https://frodo.douban.com/api/v2/status/create_status',
            encoding: 'utf8',
            headers: {
                'User-Agent': userAgent,
                'Authorization': `Bearer ${accessToken}`
            },
            form: {
                text: text
            },
            json: true,
        });
        console.log(body);
    } catch (error) {
        if (error && error.response && error.response.body) {
            switch (error.response.body.code) {
                case 103: // INVALID_ACCESS_TOKEN
                case 106: // ACCESS_TOKEN_HAS_EXPIRED
                case 119: // INVALID_REFRESH_TOKEN
                case 123: // ACCESS_TOKEN_HAS_EXPIRED_SINCE_PASSWORD_CHANGED
                    await authenticate();
                    await sendBroadcast(text);
                    return;
            }
        }
        throw error;
    }
}

const SOLAR_TERM_NAMES = [
    "立春", "雨水", "惊蛰", "春分", "清明", "谷雨",
    "立夏", "小满", "芒种", "夏至", "小暑", "大暑",
    "立秋", "处暑", "白露", "秋分", "寒露", "霜降",
    "立冬", "小雪", "大雪", "冬至", "小寒", "大寒"
];

/**
 * @param {Moment} time
 * @return {String}
 */
function getSolarTermForTime(time) {
    const calendarChinese = new CalendarChinese();
    for (let i = 0; i < 24; ++i) {
        const dateObject = calendarChinese.fromJDE(calendarChinese.solarTerm(i + 1, time.year())).toGregorian();
        const date = moment({
            year: dateObject.year,
            month: dateObject.month - 1,
            day : dateObject.day
        }).tz(timezone);
        if (date.isSame(time, 'day')) {
            return SOLAR_TERM_NAMES[i];
        }
    }
    return null;
}

const readFile = util.promisify(fs.readFile);
let holidaysCache = null;

/**
 * @return {Promise.<[{ name: string, start: Moment, end: Moment }]>}
 */
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

/**
 * @param {Moment} time
 * @return {Promise.<[string]>}
 */
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

/**
 * @return {Promise.<string>}
 */
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
    const solarTerm = getSolarTermForTime(now);
    if (solarTerm) {
        text += ` #${solarTerm}#`;
    }
    for (const holidayName of await getHolidayNamesForTime(now)) {
        text += ` #${holidayName}#`;
    }
    return text;
}

async function sendYearProgress() {
    return await sendBroadcast(await generateText());
}

/**
 * @return {Promise.<void>}
 */
async function main() {

    await authenticate();
    await sendYearProgress();

    Schedule.scheduleJob({
        hour: 10,
        minute: 0
    }, sendYearProgress);
    Schedule.scheduleJob({
        month: 11,
        date: 31,
        hour: 23,
        minute: 59,
        // Allow some execution time.
        second: 50
    }, sendYearProgress);
}

main();
