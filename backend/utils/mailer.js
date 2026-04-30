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

export const sendResetEmail = async (email, resetToken) => {
  const resetLink = `${process.env.FRONTEND_URL || 'https://minestation.tech'}/redefinir-senha?token=${resetToken}`;
  
  const mailOptions = {
    from: process.env.MAIL_FROM || '"MineStation" <no-reply@minestation.tech>',
    to: email,
    subject: 'Recuperação de Senha - MineStation',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded: 8px;">
        <h2 style="color: #0891b2; text-align: center;">Recuperação de Senha</h2>
        <p>Olá,</p>
        <p>Você solicitou a redefinição de sua senha no <strong>MineStation</strong>. Clique no botão abaixo para prosseguir:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color: #0891b2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Redefinir Minha Senha</a>
        </div>
        <p>Este link é válido por 10 minutos. Se você não solicitou esta alteração, ignore este e-mail.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 12px; color: #64748b; text-align: center;">
          MineStation - O Futuro da Mineração Web3
        </p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
};

export default transporter;
