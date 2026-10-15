# UPA Fluxo – Gestão da Unidade

App em um único arquivo (`index.html`), pronto para GitHub Pages.

## Módulos
- **Início**: painel com prontidão, prazos vencidos, conferências pendentes, serviços em aberto e lista "Atenção agora"; aviso em vermelho quando há visita/fiscalização agendada.
- **Fiscalização**: itens por órgão (validade, responsável, link do documento), % de prontidão, registro de visitas (gera prazo de resposta automático) e relatório de prontidão para imprimir/PDF.
- **Conferir**: rotinas diárias/semanais/mensais com checklist; não conformidade pode abrir serviço automaticamente.
- **Prazos**: vencimentos com prioridade e repetição (mensal a anual: ao concluir, cria o próximo).
- **Serviços**: ordens de serviço com histórico de andamentos.
- **Indicadores**: metas, semáforo, gráfico dos últimos 6 meses e exportação CSV.

As listas iniciais (órgãos, exigências, rotinas, indicadores e metas) são **sugestões**: edite/exclua conforme as exigências reais da sua unidade.

## Publicar
1. Supabase: crie um projeto, abra *SQL Editor* e execute `supabase_schema.sql`.
2. Supabase → *Authentication → Users*: crie os usuários da equipe (e-mail e senha). Em *Authentication → Providers → Email*, desative "Allow new users to sign up".
3. GitHub: suba `index.html` em um repositório e ative *Settings → Pages*.
4. Abra o app → ⚙️ → cole *Project URL* e *anon public key* (Supabase → Project Settings → API) → Salvar conexão → entre com e-mail/senha.

Sem Supabase o app funciona em modo local (dados só no aparelho). Ao conectar pela primeira vez, os dados locais sobem para o banco.
Use ⚙️ → Backup (JSON) com frequência.

## Dados
Tudo fica na tabela `registros` (coleção + JSON), o que permite acrescentar campos sem alterar o banco. Todo usuário logado vê e edita tudo.
