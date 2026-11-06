import { PUBLIC_APP_URL } from '../../publicAppUrl';

/**
 * Calendar utilities for TimeCapsule Protocol
 * Generates standard RFC 5545 (.ics) files and Google Calendar URLs
 * 100% Client-Side • Zero Server Dependency
 */


const CALENDAR_COPY: Record<string, {
  title: (capsuleId: number | string) => string;
  details: (capsuleId: number | string, networkName: string, portalUrl: string) => string;
  summary: (capsuleId: number | string, mode: string) => string;
  description: (capsuleId: number | string, networkName: string, portalUrl: string) => string;
  alarm: (capsuleId: number | string) => string;
}> = {
  en: {
    title: (id) => `🌌 TimeCapsule #${id} Unlock Reminder`,
    details: (id, network, url) => `Your TimeCapsule #${id} has reached its unlock date!\nNetwork: ${network}\nRecovery: ${url}\nOpening still requires the verified drand signal; Private capsules also need the original passphrase.`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} Unlock Reminder (${mode})`,
    description: (id, network, url) => `Capsule #${id} has reached its target date. Opening still requires the drand signal; Private capsules also need the original passphrase.\nNetwork: ${network}\nDirect Recovery: ${url}`,
    alarm: (id) => `TimeCapsule #${id} Unlock Reminder`,
  },
  zh: {
    title: (id) => `🌌 TimeCapsule #${id} 到期解锁提醒`,
    details: (id, network, url) => `你的 TimeCapsule #${id} 已到达目标解锁时间！\n网络：${network}\n恢复入口：${url}\n实际解密仍需 drand 信号；Private 胶囊还需原口令。`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} 到期解锁提醒 (${mode})`,
    description: (id, network, url) => `TimeCapsule #${id} 已到目标日期。实际解密仍需 drand 信号；Private 胶囊还需原口令。\n网络：${network}\n直接恢复入口：${url}`,
    alarm: () => 'TimeCapsule 到期解锁提醒',
  },
  ja: {
    title: (id) => `🌌 TimeCapsule #${id} 開封リマインダー`,
    details: (id, network, url) => `TimeCapsule #${id} の開封時刻が到来しました。\nネットワーク：${network}\n復元：${url}\n開封には検証済み drand シグナルが必要で、Private カプセルには元のパスフレーズも必要です。`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} 開封リマインダー (${mode})`,
    description: (id, network, url) => `カプセル #${id} が目標日時に到達しました。開封には drand シグナルが必要で、Private カプセルには元のパスフレーズも必要です。\nネットワーク：${network}\n直接復元：${url}`,
    alarm: (id) => `TimeCapsule #${id} 開封リマインダー`,
  },
  ko: {
    title: (id) => `🌌 TimeCapsule #${id} 개봉 알림`,
    details: (id, network, url) => `TimeCapsule #${id}의 개봉 시간이 도착했습니다.\n네트워크: ${network}\n복구: ${url}\n개봉에는 검증된 drand 신호가 필요하며 Private 캡슐은 원래 암호문구도 필요합니다.`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} 개봉 알림 (${mode})`,
    description: (id, network, url) => `캡슐 #${id}이 목표 날짜에 도착했습니다. 개봉에는 drand 신호가 필요하며 Private 캡슐은 원래 암호문구도 필요합니다.\n네트워크: ${network}\n직접 복구: ${url}`,
    alarm: (id) => `TimeCapsule #${id} 개봉 알림`,
  },
  'pt-BR': {
    title: (id) => `🌌 Lembrete de abertura da TimeCapsule #${id}`,
    details: (id, network, url) => `A TimeCapsule #${id} chegou à data de abertura!\nRede: ${network}\nRecuperação: ${url}\nA abertura ainda exige o sinal drand verificado; cápsulas Private também precisam da frase-senha original.`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} · Lembrete de abertura (${mode})`,
    description: (id, network, url) => `A cápsula #${id} chegou à data alvo. A abertura ainda exige o sinal drand; cápsulas Private também precisam da frase-senha original.\nRede: ${network}\nRecuperação direta: ${url}`,
    alarm: (id) => `Lembrete de abertura da TimeCapsule #${id}`,
  },
  hi: {
    title: (id) => `🌌 TimeCapsule #${id} खुलने का रिमाइंडर`,
    details: (id, network, url) => `TimeCapsule #${id} के खुलने का समय आ गया है!\nनेटवर्क: ${network}\nरिकवरी: ${url}\nखोलने के लिए verified drand signal जरूरी है; Private capsules में original passphrase भी चाहिए।`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} खुलने का रिमाइंडर (${mode})`,
    description: (id, network, url) => `Capsule #${id} target date पर पहुँच गया है। खोलने के लिए drand signal जरूरी है; Private capsules में original passphrase भी चाहिए।\nनेटवर्क: ${network}\nDirect Recovery: ${url}`,
    alarm: (id) => `TimeCapsule #${id} खुलने का रिमाइंडर`,
  },
  uk: {
    title: (id) => `🌌 Нагадування про відкриття TimeCapsule #${id}`,
    details: (id, network, url) => `TimeCapsule #${id} досягла часу відкриття!\nМережа: ${network}\nВідновлення: ${url}\nДля відкриття все ще потрібен перевірений сигнал drand; Private капсулам також потрібна початкова парольна фраза.`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} · Нагадування про відкриття (${mode})`,
    description: (id, network, url) => `Капсула #${id} досягла цільової дати. Для відкриття потрібен сигнал drand; Private капсулам також потрібна початкова парольна фраза.\nМережа: ${network}\nПряме відновлення: ${url}`,
    alarm: (id) => `Нагадування про відкриття TimeCapsule #${id}`,
  },
  ru: {
    title: (id) => `🌌 Напоминание об открытии TimeCapsule #${id}`,
    details: (id, network, url) => `TimeCapsule #${id} достигла времени открытия!\nСеть: ${network}\nВосстановление: ${url}\nДля открытия всё ещё нужен проверенный сигнал drand; Private капсулам также нужна исходная парольная фраза.`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} · Напоминание об открытии (${mode})`,
    description: (id, network, url) => `Капсула #${id} достигла целевой даты. Для открытия нужен сигнал drand; Private капсулам также нужна исходная парольная фраза.\nСеть: ${network}\nПрямое восстановление: ${url}`,
    alarm: (id) => `Напоминание об открытии TimeCapsule #${id}`,
  },
  th: {
    title: (id) => `🌌 แจ้งเตือนเปิด TimeCapsule #${id}`,
    details: (id, network, url) => `TimeCapsule #${id} ถึงเวลาเปิดแล้ว!\nเครือข่าย: ${network}\nการกู้คืน: ${url}\nการเปิดยังต้องใช้สัญญาณ drand ที่ตรวจสอบแล้ว และ Private capsule ยังต้องใช้ passphrase เดิม`,
    summary: (id, mode) => `🌌 TimeCapsule #${id} · แจ้งเตือนเปิด (${mode})`,
    description: (id, network, url) => `แคปซูล #${id} ถึงวันที่เป้าหมายแล้ว การเปิดยังต้องใช้สัญญาณ drand และ Private capsule ยังต้องใช้ passphrase เดิม\nเครือข่าย: ${network}\nกู้คืนโดยตรง: ${url}`,
    alarm: (id) => `แจ้งเตือนเปิด TimeCapsule #${id}`,
  },
};

interface CalendarEventParams {
  capsuleId: number | string;
  unlockAt: number; // Unix timestamp in seconds
  networkName: string;
  owner?: string;
  mode?: string;
  language?: string;
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

// RFC 5545 limits a content line to 75 octets. Fold without splitting a UTF-8 character.
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (bytes + width > 75) {
      lines.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += width;
  }
  lines.push(current);
  return lines.join('\r\n');
}

function formatDateToIcs(date: Date): string {
  return date.toISOString().replace(/-|:|\.\d+/g, '');
}

/**
 * Generates a direct Google Calendar creation URL
 */
export function generateGoogleCalendarUrl(params: CalendarEventParams): string {
  const { capsuleId, unlockAt, networkName, language } = params;
  const portalUrl = PUBLIC_APP_URL;
  const startDate = new Date(unlockAt * 1000);
  const endDate = new Date(unlockAt * 1000 + 3600 * 1000); // 1 hour duration

  const startIso = formatDateToIcs(startDate);
  const endIso = formatDateToIcs(endDate);
  const copy = CALENDAR_COPY[language || 'en'] || CALENDAR_COPY.en;
  const title = encodeURIComponent(copy.title(capsuleId));
  const details = encodeURIComponent(copy.details(capsuleId, networkName, portalUrl));
  const location = encodeURIComponent(portalUrl);

  // `erem` pre-fills a single Google Calendar notification at the event start.
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startIso}/${endIso}&details=${details}&location=${location}&erem=${encodeURIComponent('1:0:0')}`;
}

/**
 * Generate a portable iCalendar event with escaped text and folded UTF-8 lines.
 */
export function generateIcsCalendarContent(params: CalendarEventParams, portalUrl: string, createdAt: Date = new Date()): string {
  const { capsuleId, unlockAt, networkName, mode, language } = params;
  const startDate = new Date(unlockAt * 1000);
  const endDate = new Date(unlockAt * 1000 + 3600 * 1000);

  const startIso = formatDateToIcs(startDate);
  const endIso = formatDateToIcs(endDate);
  const nowIso = formatDateToIcs(createdAt);
  const copy = CALENDAR_COPY[language || 'en'] || CALENDAR_COPY.en;
  const resolvedMode = mode || 'Encrypted';
  const summary = copy.summary(capsuleId, resolvedMode);
  const description = copy.description(capsuleId, networkName, portalUrl);
  const alarmDescription = copy.alarm(capsuleId);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TimeCapsule Protocol//Spacetime Vault V1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:timecapsule-${networkName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${capsuleId}-${unlockAt}@timecapsule.eth`,
    `DTSTAMP:${nowIso}`,
    `DTSTART:${startIso}`,
    `DTEND:${endIso}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `URL:${portalUrl}`,
    'BEGIN:VALARM',
    'TRIGGER:PT0S',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(alarmDescription)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(foldIcsLine).join('\r\n') + '\r\n';
}

export function downloadIcsCalendarFile(params: CalendarEventParams): void {
  const { capsuleId } = params;
  const icsContent = generateIcsCalendarContent(params, PUBLIC_APP_URL);

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `TimeCapsule_#${capsuleId}_Unlock_Reminder.ics`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Chrome may start the download asynchronously after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
