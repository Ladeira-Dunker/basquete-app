# Configurar a comunidade online

## 1. Criar o banco no Supabase

1. Crie um projeto no Supabase.
2. No painel do projeto, abra **SQL Editor**, copie todo o conteúdo de `supabase/schema.sql` e execute.
3. Em **Authentication → URL Configuration**, configure a URL pública do app como **Site URL** e adicione essa URL à lista de redirecionamentos permitidos. Durante testes locais, adicione também `http://localhost:3000/**` e `http://127.0.0.1:3000/**`.
4. Em **Authentication → Providers → Email**, mantenha o login por e-mail habilitado. Se a confirmação de e-mail estiver ativa, cada pessoa precisará confirmar o endereço antes de entrar.

## 2. Conectar o app

No Supabase, copie a **Project URL** e a chave pública **anon** (ou **publishable**) e preencha `supabase-config.js`:

```js
window.QUADRA_SUPABASE_CONFIG = {
  url: "https://SEU-PROJETO.supabase.co",
  anonKey: "SUA_CHAVE_PUBLICA"
};
```

Essa chave pública é usada no navegador e fica protegida pelas políticas RLS criadas pelo schema. **Nunca coloque a chave `service_role` nesse arquivo, no GitHub ou no Vercel.** A configuração não inclui nem altera a chave Gemini em `.env`.

## 3. Publicar no Vercel

1. Envie o projeto a um repositório GitHub privado ou público.
2. Importe esse repositório no Vercel e escolha **Other** como framework.
3. Use `npm run build` como comando de build e `dist` como diretório de saída. O script copia apenas os arquivos estáticos necessários para a PWA, evitando que o Vercel tente iniciar o servidor Node local.
4. Publique e confirme que o app abre por HTTPS. O `.vercelignore` exclui `.env` e o servidor local do pacote estático.
5. Se o endereço público mudar, atualize as URLs em **Authentication → URL Configuration** no Supabase.

O Vercel publica a PWA e o cliente da comunidade como arquivos estáticos. O servidor local `server.js` não é publicado, então a rota local da IA (`/api/coach`) não fica disponível nesse deploy.

## Redes móveis, Wi-Fi, VPN e proxy

- No celular ou computador, a PWA usa a conexão padrão do navegador e do sistema operacional. A troca entre Wi-Fi, dados móveis e VPN é feita pelo próprio dispositivo; não é necessário selecionar a rede dentro do app.
- A conexão do navegador com Supabase e com a biblioteca hospedada em `cdn.jsdelivr.net` precisa ser permitida pela rede. Se um proxy bloquear esses domínios, o app não pode contornar esse bloqueio; peça a liberação ao administrador da rede.
- O servidor local `server.js` pode usar um proxy autorizado configurado nas variáveis `HTTPS_PROXY`/`HTTP_PROXY` e `NO_PROXY`. Com Node.js 22.23 ou mais recente, inicie-o com:

  ```powershell
  node --use-env-proxy server.js
  ```

- Se as variáveis ainda não estiverem configuradas, peça ao responsável pelo proxy o endereço aprovado e configure-o somente no terminal/sistema. Não grave credenciais do proxy no código ou em arquivos enviados ao GitHub.
- Abra o app por HTTPS depois de publicar, ou por `http://127.0.0.1:3000` no servidor local. Abrir `index.html` como `file://` não permite carregar corretamente os scripts nem instalar a PWA.

## O que é compartilhado

- Criar uma conta não publica estatísticas.
- O treinador cria um time e pode gerar um link de convite, válido por 14 dias. Gerar um novo link revoga o anterior.
- Jogadores precisam criar uma conta ou entrar para aceitar um convite. A adesão é explícita.
- Estatísticas começam desativadas. Se o jogador autorizar, são enviados apenas totais e médias calculados a partir das partidas salvas **neste navegador** — não são enviados adversários, campeonatos, observações ou registros individuais.
- Desativar a opção remove os totais compartilhados daquele time. Cada jogador escolhe a permissão separadamente para cada time.
- O backup local continua sendo a forma de levar partidas entre dispositivos; o app não sincroniza registros individuais.
