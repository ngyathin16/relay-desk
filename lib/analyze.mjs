const normalize = (value) => value.normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim();

function matches(text, phrase) {
  const term = normalize(phrase);
  if (/\p{Script=Han}/u.test(term)) return text.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'u').test(text);
}

function isInjection(text) {
  return /(?:ignore|disregard|override|forget|bypass|skip).{0,70}(?:instruction|rule|prompt|policy|safeguard|approval|review)|(?:reveal|print|show|expose|leak|steal|send me).{0,50}(?:system prompt|secret|api key|password|credential)|(?:system|developer)\s*[:>]|(?:忽略|不用理會|跳過|跳过).{0,30}(?:指示|指令|規則|规则|審核|审核|批准)|(?:顯示|显示|洩露|泄露|提供|交出).{0,25}(?:系統提示|系统提示|秘密|金鑰|密鑰|密钥|密碼|密码)/iu.test(text);
}

// shortcut: Conservative phrase rules cannot establish semantic answerability; keep human review, evaluate new intents before expanding coverage.
const uncoveredConcepts = [
  /refund|退款/iu, /schedul|automat(?:ic|ically|ion)|排程|自動|自动/iu,
  /processing time|how long.{0,25}export|處理時間|处理时间/iu,
  /guarantee|保證|保证/iu, /saml|single sign.on|sso/iu,
  /price|pricing|discount|cost|價格|价格|折扣/iu,
];

function lacksRequestedEvidence(text, articles) {
  const documented = articles.flatMap(({ body }) => [body.en, body.zh])
    .flatMap((body) => body.split(/(?<=[.!?。！？])\s*/u))
    .filter((sentence) => !/does not (?:specify|describe)|no promise|未列出|未說明|未承諾/iu.test(sentence)).join(' ');
  return uncoveredConcepts.some((concept) => concept.test(text) && !concept.test(documented));
}

function result(status, ticket, reply, questions = [], sources = []) {
  return { status, summary: ticket.replace(/\s+/g, ' ').slice(0, 240), reply, questions, sources };
}

export function analyze(ticket, language, articles) {
  const text = normalize(ticket);
  const zh = language === 'zh';
  if (isInjection(text)) {
    return result('blocked', ticket, zh ? '這段內容包含更改指示或索取秘密資料的要求，請先移除這些內容。' : 'This ticket includes an instruction override or a request for secrets. Remove that content before drafting a reply.');
  }
  const ranked = articles.map((article) => {
    const hits = [...new Set([...article.keywords.en, ...article.keywords.zh])].filter((keyword) => matches(text, keyword));
    const score = hits.reduce((sum, keyword) => sum + Math.min(normalize(keyword).length, 24), 0);
    return { article, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id));

  if (!ranked.length) {
    const vague = /^(?:(?:hi|hello|please|help|me|my|it|this|something|is|isnt|doesnt|not|work|working|broken|harbour|app|account|problem|issue|can|you|fix|the|a|i|have|has|been|since|yesterday|somebody|cannot|get|to|open|what|should|do|next|need|with|urgent|anyone|thanks|support)[\s,.!?]*)+$/u.test(text)
      || /^(?:你好|請|请|幫忙|帮忙|幫我|帮我|出問題|出问题|壞了|坏了|不能用|無法使用|无法使用|有問題|有问题|怎麼辦|怎么办|系統|系统|帳戶|账户|我的|我|又|剛才|刚才|操作|失敗|失败|但|不|知道|原因|出錯|出错|了|可以|處理|处理|嗎|吗|harbour|[\s,.!?，。！？])+$/iu.test(text);
    if (vague) {
      const question = zh ? '你正在使用哪個功能？請提供操作步驟及完整錯誤訊息，並移除任何密碼或金鑰。' : 'Which feature are you using, and what happened? Share the steps and exact error message, with passwords and keys removed.';
      return result('needs-information', ticket, question, [question]);
    }
    return result('no-answer', ticket, zh ? '目前的知識庫沒有足夠資料回答這個問題。請轉交人工支援確認。' : 'The current knowledge base does not contain enough evidence to answer this question. Refer it to a support specialist.');
  }

  const candidates = ranked.filter(({ score }) => score >= ranked[0].score * 0.7).slice(0, 3);
  if (lacksRequestedEvidence(text, candidates.map(({ article }) => article))) {
    return result('no-answer', ticket, zh ? '已找到相關主題，但知識庫沒有說明你詢問的功能或承諾。請轉交人工支援確認。' : 'A related topic was found, but the knowledge base does not document the capability or promise you asked about. Refer this to a support specialist.');
  }
  const sources = candidates.map(({ article }) => ({ id: article.id, title: article.title[language], excerpt: article.body[language] }));
  const hasQuestion = /[?？]|\b(?:how|why|where|when|what|which|can|could|need|want|expired|error|fail(?:ed|ing)?|reject(?:ed|ing)?|cannot|cant|unable|doesnt|401)\b|如何|怎樣|怎样|怎麼|怎么|為什麼|为什么|哪裡|哪里|過期|过期|錯誤|错误|失敗|失败|無法|无法|不能|需要/u.test(text);
  if (candidates.length > 1 || !hasQuestion) {
    const questions = candidates.map(({ article }) => article.followUp[language]);
    return result('needs-information', ticket, questions.join('\n\n'), questions, sources);
  }
  return result('answered', ticket, sources[0].excerpt, [], sources);
}
