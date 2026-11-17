// Sending mail.
//
// The rule this file follows: SENDING EMAIL MUST NEVER BREAK AN ACTION. The decision is
// saved first; every function here returns a description of what happened instead of
// throwing, and the caller records that description in the action log.
//
// Recipients are given by NAME. The address is looked up here, on the server, from
// MAIL_DIRECTORY, and never sent to the browser. Somebody with no address on file is
// written to at MAIL_TO instead, with a line at the top saying who it was for - never at
// an address guessed from their name.

import nodemailer from 'nodemailer';
import { config } from './config.js';
import { recipientFor } from './domain/recipients.js';

let transport = null;

export function mailConfigured() {
  if (!config.mail.enabled) return false;
  return Boolean(config.mail.host && config.mail.user && config.mail.password);
}

export function mailSwitchedOff() {
  return !config.mail.enabled && Boolean(config.mail.host && config.mail.user && config.mail.password);
}

function getTransport() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: { user: config.mail.user, pass: config.mail.password },
    // Give up rather than hang: a blocked port otherwise leaves the button saying
    // "Sending..." for ever.
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  return transport;
}

export async function verifyMail() {
  if (!mailConfigured()) return { ok: false, reason: 'not configured' };
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describeMailError(error) };
  }
}

/**
 * Sends one message to a named person.
 * Returns { sent, to, delivered, status, preview } and never throws.
 */
export async function sendTo({ toName, subject, lines, replyTo }) {
  const target = recipientFor(toName);
  const redirected = !target.real;
  const to = target.real ? target.address : config.mail.to || config.mail.user;

  if (!mailConfigured()) {
    return {
      sent: false,
      to: target.real ? target.address : '',
      status: mailSwitchedOff() ? 'Not sent: email is switched off' : 'Not sent: email is not configured in .env'
    };
  }
  if (!to) return { sent: false, to: '', status: 'Not sent: no address for this person and no MAIL_TO set' };

  const body = [
    ...(redirected ? [`[This message was meant for ${toName}, who has no mailbox on file. It has come to you instead.]`, ''] : []),
    ...lines
  ].join('\n');

  try {
    const info = await getTransport().sendMail({
      from: config.mail.from || config.mail.user,
      to,
      replyTo: replyTo || config.mail.noReply || undefined,
      subject,
      text: body,
      html: `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0F1A26;white-space:pre-wrap">${escapeHtml(body)}</div>`
    });
    return { sent: true, to, delivered: !redirected, status: `Sent ${info.messageId || ''}`.trim(), preview: previewLink(info) };
  } catch (error) {
    return { sent: false, to, status: `Not sent: ${describeMailError(error)}` };
  }
}

function previewLink(info) {
  const url = nodemailer.getTestMessageUrl(info);
  if (!url) return null;
  console.log(`[api] mail preview: ${url}`);
  return url;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function describeMailError(error) {
  const text = String(error.message || error);
  if (error.code === 'EAUTH' || /invalid login|username and password not accepted/i.test(text)) {
    return 'the mail server rejected the username or password. For Gmail you must use a 16-character App Password.';
  }
  if (error.code === 'ETIMEDOUT' || /timeout|timed out/i.test(text)) {
    return `nothing answered on ${config.mail.host}:${config.mail.port} within ten seconds. Something is blocking the port.`;
  }
  if (error.code === 'ECONNECTION' || error.code === 'ESOCKET') {
    return `could not connect to ${config.mail.host}:${config.mail.port}. Check the host and port.`;
  }
  if (error.code === 'EENVELOPE') return 'the recipient address was rejected.';
  return text;
}
