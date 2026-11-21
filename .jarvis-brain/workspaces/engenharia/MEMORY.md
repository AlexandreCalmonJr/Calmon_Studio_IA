# Memória Técnica do Agente — Engenharia

## Arquitetura do Cérebro
- Motor de banco: SQLite em modo WAL com tabela virtual FTS5 (BM25) e embeddings vetoriais locais em BLOB.
- Worker Python 3.11 local executa chunking de Markdown (~400 tokens), busca híbrida com fusão RRF e extração de fatos.
- Pacote Docker/VPS inclui o serviço Go para Edge Gateway, WebSockets concorrentes e workspace crawler.

## Notas Operacionais
- Backups consistentes são gerados via `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM INTO`.
- Perfis isolados mantêm arquivos `state.db` e documentos Markdown separados por diretório.
