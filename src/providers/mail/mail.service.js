const { getResend } = require('./resend.client');
const otpEmailHtml = require('./templates/otp.template');
const welcomeEmailHtml = require('./templates/welcome.template');
const verifyEmailHtml = require('./templates/verifyEmail.template');
const {
  candidateInviteEmailHtml,
  candidateAccessEmailHtml,
} = require('./templates/candidateInvite.template');

function resolveFromHeader() {
  return (process.env.EMAIL_FROM || '').trim();
}

/**
 * OTP de recuperação — falhas apenas em log (nunca propaga erro).
 */
async function sendOtpEmail(to, code) {
  try {
    const resend = getResend();
    const from = resolveFromHeader();
    if (!resend || !from) {
      console.error('[mail.service] Envio OTP não configurado — defina RESEND_API_KEY e EMAIL_FROM.');
      return;
    }

    const toAddress = `${to ?? ''}`.trim();
    if (!toAddress) {
      console.error('[mail.service] Destinatário OTP vazio.');
      return;
    }

    const html = otpEmailHtml(code, '10 minutos');
    await resend.emails.send({
      from,
      to: toAddress,
      subject: 'Fadas do Bem — código para redefinir sua senha',
      html,
    });
  } catch (err) {
    console.error('[mail.service] Falha ao enviar e-mail de OTP:', err?.message || err);
  }
}

/**
 * Boas-vindas — falhas apenas em log.
 */
async function sendWelcomeEmail(to) {
  try {
    const resend = getResend();
    const from = resolveFromHeader();
    if (!resend || !from) {
      console.error('[mail.service] Envio de boas-vindas não configurado — RESEND_API_KEY ou EMAIL_FROM ausente.');
      return;
    }

    const toAddress = `${to ?? ''}`.trim();
    if (!toAddress) {
      console.error('[mail.service] Destinatário welcome vazio.');
      return;
    }

    const html = welcomeEmailHtml(toAddress);
    await resend.emails.send({
      from,
      to: toAddress,
      subject: 'Bem-vinda às Fadas do Bem',
      html,
    });
  } catch (err) {
    console.error('[mail.service] Falha ao enviar e-mail de boas-vindas:', err?.message || err);
  }
}

async function sendVerificationEmail(to, verificationUrl) {
  try {
    const resend = getResend();
    const from = resolveFromHeader();
    if (!resend || !from) {
      console.error('[mail.service] Verificação de e-mail não configurada — RESEND_API_KEY ou EMAIL_FROM ausente.');
      return;
    }
    const toAddress = `${to ?? ''}`.trim();
    if (!toAddress || !verificationUrl) return;
    const html = verifyEmailHtml(verificationUrl);
    await resend.emails.send({
      from,
      to: toAddress,
      subject: 'Fadas do Bem — confirme seu e-mail',
      html,
    });
  } catch (err) {
    console.error('[mail.service] Falha ao enviar verificação de e-mail:', err?.message || err);
  }
}

async function sendCandidateInviteEmail(to, { apelido, onboardingLink }) {
  try {
    const resend = getResend();
    const from = resolveFromHeader();
    if (!resend || !from) {
      console.error('[mail.service] Convite candidata não configurado — RESEND_API_KEY ou EMAIL_FROM ausente.');
      return false;
    }
    const toAddress = `${to ?? ''}`.trim();
    if (!toAddress || !onboardingLink) return false;
    await resend.emails.send({
      from,
      to: toAddress,
      subject: 'Fadas do Bem — complete seu cadastro de taróloga',
      html: candidateInviteEmailHtml({ apelido, onboardingLink }),
    });
    return true;
  } catch (err) {
    console.error('[mail.service] Falha convite candidata:', err?.message || err);
    return false;
  }
}

async function sendCandidateAccessEmail(to, { apelido, email, password, expiresAt }) {
  try {
    const resend = getResend();
    const from = resolveFromHeader();
    if (!resend || !from) {
      console.error('[mail.service] Acesso candidata não configurado — RESEND_API_KEY ou EMAIL_FROM ausente.');
      return false;
    }
    const toAddress = `${to ?? ''}`.trim();
    if (!toAddress) return false;
    await resend.emails.send({
      from,
      to: toAddress,
      subject: 'Fadas do Bem — credenciais de acesso ao painel',
      html: candidateAccessEmailHtml({ apelido, email, password, expiresAt }),
    });
    return true;
  } catch (err) {
    console.error('[mail.service] Falha credenciais candidata:', err?.message || err);
    return false;
  }
}

module.exports = {
  sendOtpEmail,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendCandidateInviteEmail,
  sendCandidateAccessEmail,
};
