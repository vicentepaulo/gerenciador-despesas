# Sicredi Faturas

Aplicativo para controle de faturas do cartão Sicredi.

---

## Como usar

Acesse **https://vicentepaulo.github.io/gerenciador-despesas/** no navegador (PC ou celular).

Não precisa instalar nada. Também funciona abrindo o `index.html` direto no navegador.

---

## Estrutura de arquivos

```
gerenciador-despesas/
├── index.html      ← interface do app
├── style.css       ← estilos
└── app.js          ← lógica do app
```

---

## Dados

Tudo é salvo automaticamente no `localStorage` do navegador a cada alteração.

- Os dados ficam **só no navegador/aparelho** onde foram cadastrados — PC e celular não compartilham dados.
- Limpar os dados de navegação do site apaga as informações. Faça backups com as opções de exportar abaixo.

---

## Exportar / Importar

- **Transações:** aba Transações → botão "Exportar CSV"
- **Entradas:** aba Entradas → "Exportar JSON" / "Importar JSON"
