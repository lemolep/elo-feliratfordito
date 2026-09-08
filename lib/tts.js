/* Google Cloud Text-to-Speech kliens. Csak a service workerben és az options
   oldalon fut, így az API kulcs soha nem kerül be a megnyitott weboldalba. */
globalThis.LFT = globalThis.LFT || {};

(() => {
  'use strict';

  const BASE = 'https://texttospeech.googleapis.com/v1';

  class TtsError extends Error {
    constructor(status, message) {
      super(message);
      this.name = 'TtsError';
      this.status = status;
    }
  }

  function humanError(status) {
    switch (status) {
      case 400: return LFT.t('tts_err_request');
      case 401:
      case 403: return LFT.t('tts_err_key');
      case 429: return LFT.t('tts_err_rate');
      case 0:   return LFT.t('tts_err_offline');
      default:
        if (status >= 500) return LFT.t('tts_err_server');
        return LFT.t('tts_err_other', [String(status)]);
    }
  }

  /* A kulcsot fejlécben küldjük, nem az URL-ben — így nem kerül be
     naplókba és böngészőelőzményekbe. */
  async function call(key, path, init) {
    const opts = Object.assign({ method: 'GET' }, init || {});
    opts.headers = Object.assign({
      'X-Goog-Api-Key': String(key || '').trim(),
      'Content-Type': 'application/json; charset=utf-8'
    }, opts.headers || {});

    let res;
    try {
      res = await fetch(BASE + path, opts);
    } catch (e) {
      throw new TtsError(0, humanError(0));
    }
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j && j.error && j.error.message) || '';
      } catch (e) { /* nem JSON */ }
      throw new TtsError(res.status, humanError(res.status) + (detail ? ' — ' + detail : ''));
    }
    return res.json();
  }

  /* A hangnév elejéből jön a nyelvkód: "hu-HU-Chirp3-HD-Achernar" -> "hu-HU" */
  function langOfVoice(voiceName) {
    const p = String(voiceName || '').split('-');
    return p.length >= 2 ? p[0] + '-' + p[1] : 'hu-HU';
  }

  async function synthesize(key, text, voiceName, rate) {
    if (!key) throw new TtsError(403, LFT.t('tts_err_nokey'));
    if (!voiceName) throw new TtsError(400, LFT.t('tts_err_novoice'));

    const body = {
      input: { text: String(text) },
      voice: { languageCode: langOfVoice(voiceName), name: voiceName },
      audioConfig: { audioEncoding: 'MP3' }
    };
    /* A Chirp3 HD hangok a speakingRate-et támogatják (0.25–2.0), a pitch-et
       viszont NEM — azt szándékosan nem küldjük. */
    const r = Number(rate);
    if (r && r !== 1) body.audioConfig.speakingRate = Math.max(0.25, Math.min(2, r));

    const data = await call(key, '/text:synthesize', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const audio = (data && data.audioContent) || '';
    if (!audio) throw new TtsError(500, LFT.t('tts_err_empty'));
    return audio;   // base64 MP3
  }

  async function voices(key, languageCode) {
    if (!key) throw new TtsError(403, LFT.t('tts_err_nokey'));
    const q = languageCode ? '?languageCode=' + encodeURIComponent(languageCode) : '';
    const data = await call(key, '/voices' + q);
    return (data && data.voices) || [];
  }

  /* A DeepL célnyelv kódjából a Google nyelvszűrője. A legtöbb esetben az
     elsődleges alnyelv elég ("EN-GB" -> "en"); a kínainál a Google más
     kódot használ. */
  const LANG_ALIAS = { ZH: 'cmn', 'ZH-HANS': 'cmn', 'ZH-HANT': 'cmn' };

  function voiceLangFor(deeplCode) {
    const up = String(deeplCode || 'HU').toUpperCase();
    if (LANG_ALIAS[up]) return LANG_ALIAS[up];
    return up.split('-')[0].toLowerCase();
  }

  /* Alapértelmezett hang egy nyelvhez: lehetőleg Chirp3 HD, különben az első. */
  function pickDefaultVoice(list) {
    if (!list || !list.length) return null;
    const chirp = list.find(v => /Chirp3-HD/i.test(v.name));
    return (chirp || list[0]).name;
  }

  function labelFor(v) {
    const g = v.ssmlGender ? v.ssmlGender.toLowerCase() : '';
    const kind = /Chirp3-HD/i.test(v.name) ? 'Chirp3 HD'
      : /Studio/i.test(v.name) ? 'Studio'
      : /Neural2|Wavenet/i.test(v.name) ? 'Neural' : 'Standard';
    const short = String(v.name).replace(/^[a-z]{2,3}-[A-Za-z]+-/, '');
    return short + ' · ' + kind + (g ? ' · ' + g : '');
  }

  LFT.tts = {
    synthesize, voices, humanError, langOfVoice, voiceLangFor,
    pickDefaultVoice, labelFor, TtsError
  };
})();
