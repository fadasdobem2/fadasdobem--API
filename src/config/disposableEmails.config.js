'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Domínios descartáveis (R14).
 * - Lista bundled (~7k) + manual em src/config/data/
 * - Opcional: fetch remoto no arranque (DISPOSABLE_LIST_URL / DISPOSABLE_LIST_FETCH)
 */

const STATIC_DOMAINS = [
  'mailinator.com',
  'tempmail.com',
  'tempmail.net',
  'tempmailo.com',
  'temp-mail.org',
  'temp-mail.io',
  'tempail.com',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'grr.la',
  '10minutemail.com',
  '10minutemail.net',
  'trashmail.com',
  'trashmail.net',
  'yopmail.com',
  'yopmail.fr',
  'getnada.com',
  'maildrop.cc',
  'sharklasers.com',
  'dispostable.com',
  'throwaway.email',
  'mailnesia.com',
  'fakeinbox.com',
  'emailondeck.com',
  'mailcatch.com',
  'mail.tm',
  'mohmal.com',
  'emailfake.com',
  'burnermail.io',
  'minuteinbox.com',
  'inboxbear.com',
  'tmpmail.net',
  'dropmail.me',
  'emlhub.com',
  'discard.email',
  'harakirimail.com',
  'mailpoof.com',
  'crazymailing.com',
  'tmailor.com',
  'emailnator.com',
  'icotz.com',
];

/** Substrings no domínio que indicam e-mail descartável (complementa a lista). */
const DISPOSABLE_DOMAIN_HINTS = [
  'tempmail',
  'temp-mail',
  'temp_mail',
  'mailinator',
  'guerrillamail',
  '10minutemail',
  'yopmail',
  'trashmail',
  'fakeinbox',
  'dispostable',
  'getnada',
  'maildrop',
  'throwaway',
  'burnermail',
  'mohmal',
  'emailfake',
  'sharklasers',
  'mailnesia',
  'mailcatch',
  'emailondeck',
  'minuteinbox',
  'discard',
  'tmpmail',
  'dropmail',
  'mailpoof',
  'emailnator',
  'tmailor',
];

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_REMOTE_LIST_URL =
  'https://raw.githubusercontent.com/disposable/disposable-email-domains/master/domains.txt';

const disposableSet = new Set();

function normalizeDomain(raw) {
  return `${raw || ''}`.trim().toLowerCase().split('#')[0].trim();
}

function mergeDomainLine(line) {
  const d = normalizeDomain(line);
  if (!d || !d.includes('.')) return;
  disposableSet.add(d);
}

function loadBundledFile(name) {
  const fp = path.join(DATA_DIR, name);
  if (!fs.existsSync(fp)) return 0;
  const before = disposableSet.size;
  const content = fs.readFileSync(fp, 'utf8');
  for (const line of content.split(/\r?\n/)) mergeDomainLine(line);
  return disposableSet.size - before;
}

function loadBundledBlocklists() {
  disposableSet.clear();
  for (const d of STATIC_DOMAINS) mergeDomainLine(d);
  const core = loadBundledFile('disposable_email_blocklist.conf');
  const manual = loadBundledFile('disposable_email_manual.conf');
  return { core, manual, total: disposableSet.size };
}

loadBundledBlocklists();

/**
 * Carrega lista remota (~74k domínios) e faz merge. Chamado no arranque da API.
 * @returns {Promise<number>} total de domínios na blocklist
 */
async function warmDisposableBlocklist() {
  if (`${process.env.DISPOSABLE_LIST_FETCH || ''}`.trim().toLowerCase() === 'false') {
    console.log(`[disposable] ${disposableSet.size} domínios (apenas bundled)`);
    return disposableSet.size;
  }

  const url = `${process.env.DISPOSABLE_LIST_URL || DEFAULT_REMOTE_LIST_URL}`.trim();
  const before = disposableSet.size;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) mergeDomainLine(line);
    console.log(
      `[disposable] ${disposableSet.size} domínios (+${disposableSet.size - before} remotos de ${url})`
    );
  } catch (err) {
    console.warn(
      `[disposable] fetch remoto falhou (${err.message}); usando ${disposableSet.size} domínios bundled`
    );
  }

  return disposableSet.size;
}

function getDisposableDomainCount() {
  return disposableSet.size;
}

/**
 * @param {string} domain — domínio já em minúsculas (ex.: `mailinator.com`)
 */
function isDisposableEmailDomain(domain) {
  const d = normalizeDomain(domain);
  if (!d) return false;
  if (disposableSet.has(d)) return true;

  const parts = d.split('.');
  for (let i = 1; i < parts.length; i += 1) {
    const parent = parts.slice(i).join('.');
    if (disposableSet.has(parent)) return true;
  }

  if (DISPOSABLE_DOMAIN_HINTS.some((hint) => d.includes(hint))) return true;
  return false;
}

/**
 * @param {string} normalizedEmail — e-mail já normalizado (`trim` + `toLowerCase`)
 */
function isDisposableEmailAddress(normalizedEmail) {
  const at = `${normalizedEmail || ''}`.lastIndexOf('@');
  if (at < 1) return false;
  return isDisposableEmailDomain(normalizedEmail.slice(at + 1));
}

module.exports = {
  DISPOSABLE_EMAIL_DOMAINS: STATIC_DOMAINS,
  DISPOSABLE_DOMAIN_HINTS,
  warmDisposableBlocklist,
  getDisposableDomainCount,
  isDisposableEmailDomain,
  isDisposableEmailAddress,
};
