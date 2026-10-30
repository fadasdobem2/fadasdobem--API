'use strict';

function candidateInviteEmailHtml({ apelido, onboardingLink }) {
  const nome = `${apelido || 'Taróloga'}`.trim();
  const link = `${onboardingLink || '#'}`.trim();
  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family:Georgia,serif;background:#faf8f5;color:#2a2218;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e8e0d4">
    <h1 style="font-size:22px;margin:0 0 16px;color:#5c3d2e">Bem-vinda ao Círculo, ${nome}!</h1>
    <p style="line-height:1.6;margin:0 0 20px">Sua candidatura foi aprovada. Complete o formulário de onboarding pelo link abaixo:</p>
    <p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#5c3d2e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Acessar formulário</a></p>
    <p style="font-size:13px;color:#8a7a6a;margin:0">Se o botão não funcionar, copie e cole este endereço no navegador:<br>${link}</p>
  </div>
</body>
</html>`;
}

function candidateAccessEmailHtml({ apelido, email, password, expiresAt }) {
  const nome = `${apelido || 'Taróloga'}`.trim();
  return `<!DOCTYPE html>
<html lang="pt-BR">
<body style="font-family:Georgia,serif;background:#faf8f5;color:#2a2218;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e8e0d4">
    <h1 style="font-size:22px;margin:0 0 16px;color:#5c3d2e">Seu acesso, ${nome}</h1>
    <p style="line-height:1.6">Use as credenciais abaixo para entrar no painel da taróloga:</p>
    <ul style="line-height:1.8">
      <li><strong>E-mail:</strong> ${email}</li>
      <li><strong>Senha provisória:</strong> ${password}</li>
    </ul>
    ${expiresAt ? `<p style="font-size:13px;color:#8a7a6a">Link válido até ${expiresAt}.</p>` : ''}
    <p style="font-size:13px;color:#8a7a6a;margin-top:20px">Altere sua senha após o primeiro acesso.</p>
  </div>
</body>
</html>`;
}

module.exports = { candidateInviteEmailHtml, candidateAccessEmailHtml };
