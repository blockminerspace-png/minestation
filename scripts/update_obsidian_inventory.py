import os

# Configurações de caminhos
BASE_DIR = "/home/gustavo/Documentos/MineStation/Minestation V0.5 V0.01"
DOCS_DIR = os.path.join(BASE_DIR, "Obsidian_Docs/70 - Inventário Detalhado")

# Mapeamento de pastas para documentar
MAP = {
    "Backend - Controllers": "backend/controllers",
    "Backend - Modelos": "backend/models",
    "Backend - Scripts": "backend/scripts",
    "Frontend - Componentes": "frontend/components",
    "Frontend - Servicos": "frontend/services"
}

def generate_docs():
    # Garante que a pasta de destino existe
    if not os.path.exists(DOCS_DIR):
        os.makedirs(DOCS_DIR, exist_ok=True)

    for title, folder in MAP.items():
        full_path = os.path.join(BASE_DIR, folder)
        if not os.path.exists(full_path): 
            print(f"Aviso: Pasta não encontrada {full_path}")
            continue
        
        content = f"# {title}\n\nEste arquivo foi gerado automaticamente a partir do código real.\n\n"
        
        files = sorted(os.listdir(full_path))
        for f in files:
            # Ignorar diretórios e arquivos que não são de código lógico
            if os.path.isdir(os.path.join(full_path, f)): continue
            if not f.endswith(('.ts', '.tsx', '.js', '.mjs', '.sh')): continue
            
            file_path = os.path.join(full_path, f)
            
            # Tenta ler imports para identificar comunicação e propósito
            comms = "Geral / Utilitários"
            purpose = "Lógica de backend / frontend"
            
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as content_file:
                    text = content_file.read()
                    
                    # Comunicação
                    targets = []
                    if 'db' in text or 'pool' in text or 'SELECT' in text: targets.append("PostgreSQL (Banco)")
                    if 'api' in text or 'fetch' in text or 'axios' in text: targets.append("Rede / API Externa")
                    if 'fs' in text or 'path' in text: targets.append("Sistema de Arquivos")
                    if 'WebSocket' in text or 'ws' in text: targets.append("WebSocket (Real-time)")
                    
                    if targets:
                        comms = " <-> ".join(targets)
                    
                    # Propósito (tentativa de inferência)
                    if 'isAdmin' in text or 'admin' in text.lower(): purpose = "Operação Administrativa"
                    elif 'auth' in text.lower() or 'jwt' in text.lower(): purpose = "Segurança e Sessão"
                    elif 'mining' in text.lower() or 'yield' in text.lower(): purpose = "Mecânica de Jogo (Mineração)"
                    elif 'p2p' in text.lower() or 'market' in text.lower(): purpose = "Economia / Mercado"
                    
            except Exception as e:
                print(f"Erro ao ler {f}: {e}")
            
            content += f"### `{f}`\n"
            content += f"- **Caminho**: `{folder}/{f}`\n"
            content += f"- **Comunicação**: {comms}\n"
            content += f"- **Finalidade Sugerida**: {purpose}\n\n"
        
        # Salva o arquivo no Obsidian
        doc_path = os.path.join(DOCS_DIR, f"{title}.md")
        with open(doc_path, "w", encoding='utf-8') as out:
            out.write(content)
            out.write("\n---\n[[70 - Inventário Detalhado|⬅ Voltar para Inventário]]")

if __name__ == "__main__":
    generate_docs()
    print("Documentação do Obsidian gerada com sucesso!")
