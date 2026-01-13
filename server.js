// ============================================
// AURORA WHATSAPP BACKEND - PROJETO COMPLETO
// ============================================
// Este é o servidor que conecta sua Aurora com WhatsApp
// Desenvolvido para funcionar no Render (gratuito)

import express from 'express';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(express.json());

// ========== CONFIGURAÇÕES ==========
const CONFIG = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || 'https://evolution-api-kvw7.onrender.com',
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY || 'MinhaChaveSecreta123',
  EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE || 'chatbot-vendas',
  PORT: process.env.PORT || 10000,
  RUBENS_PHONE: process.env.RUBENS_PHONE || '5551998050105'
};

// Validação
if (!CONFIG.GEMINI_API_KEY) {
  console.error('❌ ERRO: GEMINI_API_KEY não configurada!');
  process.exit(1);
}

// ========== SERVIÇO GEMINI ==========
const ai = new GoogleGenAI({ apiKey: CONFIG.GEMINI_API_KEY });

const getAuroraSystemPrompt = (userName) => `
Você é a Aurora, Consultora Estratégica da Make IA.

PERSONALIDADE:
- Profissional, mas descontraída
- Use emojis com moderação (1-2 por mensagem)
- Linguagem natural do Brasil
- Seja direta e objetiva

SERVIÇOS MAKE IA:
- Chatbots Humanizados com IA
- Sites de Alta Conversão
- Influencers Virtuais e Avatares IA
- Comerciais com IA (TV/Web)
- Aplicativos Inteligentes

OBJETIVO:
Identificar necessidades do cliente e direcionar para:
1. Agendamento de reunião
2. Falar com o Rubens (fundador)

${userName ? `Cliente: ${userName}` : 'Descubra o nome do cliente naturalmente.'}

IMPORTANTE:
- Respostas curtas (máximo 3 linhas no WhatsApp)
- Foque em benefícios práticos
- Pergunte sobre o negócio do cliente
- Se cliente demonstrar interesse, ofereça contato com Rubens
`;

// ========== GERENCIAMENTO DE CONVERSAS ==========
const conversas = new Map();

function getConversa(numero) {
  if (!conversas.has(numero)) {
    conversas.set(numero, {
      userName: null,
      messages: [],
      lastActivity: new Date(),
      leadScore: 0
    });
  }
  return conversas.get(numero);
}

function salvarMensagem(numero, role, text) {
  const conversa = getConversa(numero);
  conversa.messages.push({ role, text, timestamp: new Date() });
  conversa.lastActivity = new Date();
  
  // Mantém últimas 20 mensagens
  if (conversa.messages.length > 20) {
    conversa.messages = conversa.messages.slice(-20);
  }
  
  // Calcula score do lead
  if (role === 'user') {
    const textLower = text.toLowerCase();
    if (textLower.includes('preço') || textLower.includes('custo') || 
        textLower.includes('quanto') || textLower.includes('valor')) {
      conversa.leadScore += 10;
    }
    if (textLower.includes('contratar') || textLower.includes('quero') || 
        textLower.includes('preciso')) {
      conversa.leadScore += 20;
    }
  }
  
  return conversa;
}

// ========== GEMINI IA ==========
async function gerarResposta(mensagem, numero) {
  const conversa = getConversa(numero);
  
  try {
    const history = conversa.messages.slice(-10).map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

    const chat = ai.chats.create({
      model: 'gemini-2.0-flash-exp',
      history,
      config: {
        systemInstruction: getAuroraSystemPrompt(conversa.userName),
        temperature: 0.85,
        maxOutputTokens: 300 // Respostas curtas para WhatsApp
      }
    });

    const result = await chat.sendMessage({ message: mensagem });
    let resposta = result.text?.trim();
    
    // Detecta nome do cliente
    if (!conversa.userName && mensagem.length < 50) {
      const palavrasComuns = ['oi', 'olá', 'ola', 'bom', 'dia', 'tarde', 'noite', 'tudo', 'bem'];
      const palavras = mensagem.toLowerCase().split(/\s+/);
      const possivelNome = palavras.find(p => 
        p.length > 2 && 
        !palavrasComuns.includes(p) && 
        /^[a-záàâãéèêíïóôõöúçñ]+$/i.test(p)
      );
      
      if (possivelNome) {
        conversa.userName = possivelNome.charAt(0).toUpperCase() + possivelNome.slice(1);
        console.log(`✨ Nome detectado: ${conversa.userName}`);
      }
    }
    
    // Se lead está quente, menciona Rubens
    if (conversa.leadScore >= 30 && !resposta.toLowerCase().includes('rubens')) {
      resposta += '\n\nQuer falar direto com o Rubens, nosso fundador? Ele pode te passar um orçamento personalizado! 😊';
    }
    
    return resposta || 'Desculpe, pode repetir? Não entendi bem. 😅';
    
  } catch (error) {
    console.error('❌ Erro no Gemini:', error.message);
    return 'Ops, tive um probleminha técnico. Pode repetir sua mensagem? 🔧';
  }
}

// ========== ENVIAR MENSAGEM WHATSAPP ==========
async function enviarMensagem(numero, texto) {
  try {
    const url = `${CONFIG.EVOLUTION_API_URL}/message/sendText/${CONFIG.EVOLUTION_INSTANCE}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        number: numero,
        text: texto
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Erro ao enviar:', response.status, errorText);
      return false;
    }

    const data = await response.json();
    console.log(`✅ Mensagem enviada para ${numero}`);
    return true;
    
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error.message);
    return false;
  }
}

// ========== WEBHOOK EVOLUTION API ==========
app.post('/webhook', async (req, res) => {
  // Responde imediatamente para evitar timeout
  res.status(200).json({ received: true });
  
  try {
    const { event, data } = req.body;
    
    // Só processa mensagens recebidas
    if (event !== 'messages.upsert') {
      return;
    }
    
    const message = data?.message || data;
    if (!message || message.key?.fromMe) {
      return; // Ignora mensagens próprias
    }
    
    const numero = message.key?.remoteJid;
    if (!numero?.includes('@s.whatsapp.net')) {
      return; // Ignora grupos
    }
    
    // Extrai texto
    const texto = message.message?.conversation || 
                  message.message?.extendedTextMessage?.text ||
                  message.message?.imageMessage?.caption ||
                  '';
    
    if (!texto.trim()) {
      return;
    }
    
    console.log(`\n📨 [${new Date().toLocaleTimeString()}] ${numero}`);
    console.log(`💬 Cliente: ${texto}`);
    
    // Salva mensagem do usuário
    salvarMensagem(numero, 'user', texto);
    
    // Marca como "digitando" (opcional)
    await fetch(`${CONFIG.EVOLUTION_API_URL}/chat/markPresence/${CONFIG.EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        number: numero,
        presence: 'composing'
      })
    }).catch(() => {});
    
    // Pequeno delay para parecer mais humano
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    // Gera resposta com IA
    const resposta = await gerarResposta(texto, numero);
    
    // Salva resposta
    salvarMensagem(numero, 'model', resposta);
    
    // Envia resposta
    console.log(`🤖 Aurora: ${resposta}\n`);
    await enviarMensagem(numero, resposta);
    
  } catch (error) {
    console.error('❌ Erro no webhook:', error.message);
  }
});

// ========== ROTAS DE STATUS ==========
app.get('/', (req, res) => {
  const totalConversas = conversas.size;
  const totalMensagens = Array.from(conversas.values())
    .reduce((sum, c) => sum + c.messages.length, 0);
  
  res.json({
    status: '✅ Online',
    service: 'Aurora WhatsApp Backend',
    uptime: process.uptime(),
    stats: {
      conversas: totalConversas,
      mensagens: totalMensagens
    },
    config: {
      instance: CONFIG.EVOLUTION_INSTANCE,
      evolution: CONFIG.EVOLUTION_API_URL
    },
    endpoints: {
      webhook: 'POST /webhook',
      health: 'GET /health',
      stats: 'GET /stats'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString() 
  });
});

app.get('/stats', (req, res) => {
  const conversasArray = Array.from(conversas.entries()).map(([numero, conv]) => ({
    numero: numero.replace(/\d(?=\d{4})/g, '*'), // Oculta parte do número
    userName: conv.userName,
    mensagens: conv.messages.length,
    leadScore: conv.leadScore,
    lastActivity: conv.lastActivity
  }));
  
  res.json({
    total: conversas.size,
    conversas: conversasArray
  });
});

// ========== LIMPEZA AUTOMÁTICA ==========
setInterval(() => {
  const agora = new Date();
  let removidas = 0;
  
  for (const [numero, conv] of conversas.entries()) {
    const inativo = (agora - conv.lastActivity) / (1000 * 60 * 60); // horas
    if (inativo > 24) { // Remove conversas inativas há mais de 24h
      conversas.delete(numero);
      removidas++;
    }
  }
  
  if (removidas > 0) {
    console.log(`🧹 Limpeza: ${removidas} conversas antigas removidas`);
  }
}, 60 * 60 * 1000); // A cada 1 hora

// ========== INICIAR SERVIDOR ==========
app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║     🤖 AURORA WHATSAPP BACKEND ATIVO      ║
║                                            ║
║  Porta: ${CONFIG.PORT}                           ║
║  Instância: ${CONFIG.EVOLUTION_INSTANCE}              ║
║  Webhook: /webhook                         ║
║                                            ║
╚════════════════════════════════════════════╝
  `);
  console.log(`✅ Sistema pronto para receber mensagens!`);
  console.log(`📡 Aguardando conexões...\n`);
});
