# Sicredi Faturas

Aplicativo local para controle de faturas do cartão Sicredi.

---

## Como usar

### 1. Instale o Node.js
Baixe em https://nodejs.org (versão 18 ou superior).

### 2. Inicie o servidor
Abra o terminal nesta pasta e rode:

```
node server.js
```

Você verá algo como:

```
✅  Servidor rodando!
   PC:      http://localhost:3000
   Celular: http://192.168.1.10:3000  (mesmo Wi-Fi)

   Dados salvos em: dados/dados.json
   Para parar: Ctrl+C
```

### 3. Abra no navegador
- **PC:** http://localhost:3000  
- **Celular / outro dispositivo (mesmo Wi-Fi):** use o IP mostrado no terminal

---

## Estrutura de arquivos

```
sicredi-app/
├── server.js       ← servidor Node.js (inicie aqui)
├── index.html      ← interface do app
├── style.css       ← estilos
├── app.js          ← lógica do app
└── dados/
    └── dados.json  ← seus dados (criado automaticamente)
```

---

## Dados

Tudo é salvo em `dados/dados.json` automaticamente a cada alteração.  
Você pode fazer backup deste arquivo ou movê-lo entre máquinas.

**Fallback offline:** se o servidor não estiver rodando e você abrir o `index.html`
direto no navegador, o app usará o `localStorage` do navegador como cache temporário.

---

## Exportar / Importar

- **Transações:** aba Transações → botão "Exportar CSV"
- **Entradas:** aba Entradas → "Exportar JSON" / "Importar JSON"
