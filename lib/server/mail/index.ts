export {
  MAIL_CATEGORIES,
  sendMail,
  type MailActor,
  type MailCategory,
  type SendMailInput,
  type SendMailResult,
} from "./send";
export { appEmailSender, emailConfigured, missingApiKeyMessage } from "./transport";
export {
  mailLogoUrl,
  renderMail,
  renderMailText,
  type MailContent,
  type MailCta,
  type MailRow,
} from "./template";
