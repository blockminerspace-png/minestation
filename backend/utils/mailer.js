import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.MAIL_PORT || '465'),
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

export const sendResetEmail = async (email, resetToken, opts = {}) => {
  const validityMinutes = typeof opts.validityMinutes === 'number' && opts.validityMinutes > 0 ? opts.validityMinutes : 60;
  const enc = encodeURIComponent(resetToken);
  const resetLink = `${process.env.FRONTEND_URL || 'https://genesisdao.tech'}/redefinir-senha?token=${enc}`;

  const mailOptions = {
    from: process.env.MAIL_FROM || '"Genesis Miner" <no-reply@minestation.tech>',
    to: email,
    subject: 'Redefinição de senha — Genesis Miner',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #b45309; text-align: center;">Redefinição de senha</h2>
        <p>Olá,</p>
        <p>Recebemos um pedido para redefinir a senha da sua conta no <strong>Genesis Miner</strong>. Use o botão abaixo (ou copie o link se o botão não abrir):</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #d97706; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Redefinir minha senha</a>
        </div>
        <p style="font-size: 13px; color: #475569;">Este link expira em cerca de <strong>${validityMinutes} minutos</strong>. Se não foi você, ignore este email — a sua palavra-passe não será alterada.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 11px; color: #94a3b8; word-break: break-all;">${resetLink}</p>
        <p style="font-size: 12px; color: #64748b; text-align: center;">
          Genesis Miner
        </p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};

export default transporter;
