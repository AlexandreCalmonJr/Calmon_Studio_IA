import React, { useState, useRef } from 'react';
import {
  Zap,
  Plus,
  Play,
  ZoomIn,
  ZoomOut,
  MousePointer2,
  Hand,
  PenTool,
  StickyNote,
  SquareCode,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bot,
  Webhook,
  Clock,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { notify } from '../../shared/common/Toast';

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'agent' | 'condition' | 'action' | 'note';
  title: string;
  subtitle: string;
  iconName: 'zap' | 'bot' | 'clock' | 'webhook' | 'sparkles' | 'note';
  x: number;
  y: number;
  status: 'idle' | 'running' | 'success' | 'error';
  config?: Record<string, any>;
}

export interface WorkflowConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

const INITIAL_NODES: WorkflowNode[] = [
  {
    id: 'node-trigger-1',
    type: 'trigger',
    title: 'Gatilho de Entrada',
    subtitle: 'Webhook ou Mensagem do Chat',
    iconName: 'zap',
    x: 180,
    y: 220,
    status: 'idle',
  },
  {
    id: 'node-agent-1',
    type: 'agent',
    title: 'Especialista Orchestrator',
    subtitle: 'Roteamento Inteligente & Decomposição',
    iconName: 'bot',
    x: 520,
    y: 220,
    status: 'idle',
  },
  {
    id: 'node-action-1',
    type: 'action',
    title: 'Despacho & Notificação',
    subtitle: 'Alerta via Telegram / Hub UI',
    iconName: 'sparkles',
    x: 860,
    y: 220,
    status: 'idle',
  },
];

const INITIAL_CONNECTIONS: WorkflowConnection[] = [
  { id: 'conn-1', fromNodeId: 'node-trigger-1', toNodeId: 'node-agent-1' },
  { id: 'conn-2', fromNodeId: 'node-agent-1', toNodeId: 'node-action-1' },
];

export const WorkflowCanvasView: React.FC = () => {
  const [nodes, setNodes] = useState<WorkflowNode[]>(INITIAL_NODES);
  const [connections, setConnections] = useState<WorkflowConnection[]>(INITIAL_CONNECTIONS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'pan' | 'draw' | 'note' | 'node' | 'text' | 'search'>('select');
  const [zoom, setZoom] = useState(100);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [workflowTitle, setWorkflowTitle] = useState('Fluxos de trabalho sem título');
  const [titleDropdownOpen, setTitleDropdownOpen] = useState(false);
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [addNodeMenuOpen, setAddNodeMenuOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 15, 200));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 15, 40));
  const handleResetZoom = () => {
    setZoom(100);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleNodeMouseDown = (e: React.MouseEvent, id: string) => {
    if (activeTool !== 'select') return;
    e.stopPropagation();
    setSelectedNodeId(id);
    setDraggingNodeId(id);
    const node = nodes.find((n) => n.id === id);
    if (node) {
      setDragOffset({
        x: e.clientX / (zoom / 100) - node.x,
        y: e.clientY / (zoom / 100) - node.y,
      });
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'pan' || e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    } else {
      setSelectedNodeId(null);
      setAddNodeMenuOpen(false);
      setTitleDropdownOpen(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
    } else if (draggingNodeId) {
      const scale = zoom / 100;
      const newX = Math.round(e.clientX / scale - dragOffset.x);
      const newY = Math.round(e.clientY / scale - dragOffset.y);
      setNodes((prev) =>
        prev.map((n) => (n.id === draggingNodeId ? { ...n, x: newX, y: newY } : n))
      );
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  const handleAddNode = (type: WorkflowNode['type'], title: string, subtitle: string, iconName: WorkflowNode['iconName']) => {
    const id = `node-${Date.now()}`;
    const newNode: WorkflowNode = {
      id,
      type,
      title,
      subtitle,
      iconName,
      x: 350 - panOffset.x / (zoom / 100),
      y: 250 - panOffset.y / (zoom / 100),
      status: 'idle',
    };
    setNodes((prev) => [...prev, newNode]);
    if (selectedNodeId) {
      setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId: selectedNodeId, toNodeId: id }]);
    }
    setSelectedNodeId(id);
    setAddNodeMenuOpen(false);
    notify(`Nó "${title}" adicionado ao fluxo.`, 'info');
  };

  const handleRunWorkflow = () => {
    notify(
      'Execução de fluxos ainda não está disponível: o canvas é apenas um editor visual.',
      'warning'
    );
  };

  const handleDeleteSelected = () => {
    if (!selectedNodeId) return;
    setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setConnections((prev) => prev.filter((c) => c.fromNodeId !== selectedNodeId && c.toNodeId !== selectedNodeId));
    setSelectedNodeId(null);
    notify('Nó removido do fluxo.', 'info');
  };

  const getNodeCenter = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return { x: 0, y: 0 };
    return {
      x: node.x + 130,
      y: node.y + 45,
    };
  };

  const renderIcon = (name: WorkflowNode['iconName']) => {
    switch (name) {
      case 'zap': return <Zap size={16} color="#fbbf24" />;
      case 'bot': return <Bot size={16} color="var(--accent-light)" />;
      case 'clock': return <Clock size={16} color="var(--accent-light)" />;
      case 'webhook': return <Webhook size={16} color="#4ade80" />;
      case 'note': return <StickyNote size={16} color="#fbbf24" />;
      default: return <Sparkles size={16} color="var(--accent-light)" />;
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 'calc(100vh - 60px)',
        backgroundColor: 'var(--bg-primary)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Header */}
      <header
        style={{
          height: '52px',
          padding: '0 20px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          zIndex: 30,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="btn btn-ghost btn-icon-sm"
              title="Voltar"
              aria-label="Voltar"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => window.history.forward()}
              className="btn btn-ghost btn-icon-sm"
              title="Avançar"
              aria-label="Avançar"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div style={{ position: 'relative', minWidth: 0 }}>
            <button
              type="button"
              onClick={() => setTitleDropdownOpen(!titleDropdownOpen)}
              className="btn btn-ghost btn-sm"
            >
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{workflowTitle}</span>
              <ChevronDown size={14} color="var(--text-muted)" />
            </button>

            {titleDropdownOpen && (
              <div
                className="jarvis-popover"
                style={{
                  position: 'absolute',
                  top: '38px',
                  left: 0,
                  width: '250px',
                  zIndex: 50,
                }}
              >
                {isRenamingTitle ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const cleaned = renameDraft.trim();
                      if (cleaned) setWorkflowTitle(cleaned);
                      setIsRenamingTitle(false);
                      setTitleDropdownOpen(false);
                    }}
                    style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px' }}
                  >
                    <input
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      autoFocus
                      aria-label="Novo nome do fluxo"
                      className="jarvis-input"
                      style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                    />
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => setIsRenamingTitle(false)}
                      >
                        Cancelar
                      </button>
                      <button type="submit" className="btn btn-primary btn-xs">
                        Salvar
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRenameDraft(workflowTitle);
                      setIsRenamingTitle(true);
                    }}
                    className="btn btn-ghost btn-sm btn-block btn-start"
                  >
                    Renomear fluxo
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    notify('Fluxo duplicado com sucesso!', 'info');
                    setTitleDropdownOpen(false);
                  }}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  Duplicar fluxo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNodes(INITIAL_NODES);
                    setConnections(INITIAL_CONNECTIONS);
                    setTitleDropdownOpen(false);
                    notify('Canvas restaurado para o padrão.', 'info');
                  }}
                  className="btn btn-danger-ghost btn-sm btn-block btn-start"
                >
                  Limpar / Restaurar nós
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {selectedNodeId && (
            <button
              type="button"
              onClick={handleDeleteSelected}
              className="btn btn-danger-ghost btn-sm"
              title="Excluir nó selecionado"
            >
              <Trash2 size={14} />
              <span>Excluir Nó</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleRunWorkflow}
            className="btn btn-primary btn-sm"
            title="A execução de fluxos ainda não está ligada ao orquestrador"
          >
            <Play size={13} fill="currentColor" />
            <span>Executar Fluxo</span>
          </button>
        </div>
      </header>

      {/* Infinite Canvas com Dot Grid */}
      <div
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          flex: 1,
          position: 'relative',
          cursor: activeTool === 'pan' || isPanning ? 'grab' : 'default',
          backgroundImage: 'radial-gradient(circle, rgba(148, 163, 184, 0.16) 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
          backgroundColor: 'var(--bg-primary)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom / 100})`,
            transformOrigin: '0 0',
            transition: isPanning || draggingNodeId ? 'none' : 'transform 0.15s ease-out',
          }}
        >
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '4000px',
              height: '4000px',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            {connections.map((conn) => {
              const from = getNodeCenter(conn.fromNodeId);
              const to = getNodeCenter(conn.toNodeId);
              const dx = to.x - from.x;
              const controlOffset = Math.max(Math.abs(dx) * 0.45, 60);
              const pathData = `M ${from.x} ${from.y} C ${from.x + controlOffset} ${from.y}, ${to.x - controlOffset} ${to.y}, ${to.x} ${to.y}`;

              return (
                <g key={conn.id}>
                  <path
                    d={pathData}
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.18)"
                    strokeWidth="2.5"
                  />
                </g>
              );
            })}
          </svg>

          {nodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isNodeRunning = node.status === 'running';
            const isSuccess = node.status === 'success';

            return (
              <div
                key={node.id}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                style={{
                  position: 'absolute',
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: '260px',
                  backgroundColor: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-surface)',
                  borderRadius: 'var(--radius-lg)',
                  border: isSelected
                    ? '2px solid var(--accent-color)'
                    : isNodeRunning
                    ? '2px solid #f59e0b'
                    : isSuccess
                    ? '1.5px solid #4ade80'
                    : '1px solid var(--border-color)',
                  boxShadow: isSelected
                    ? '0 10px 28px rgba(59, 130, 246, 0.22)'
                    : 'var(--shadow-panel)',
                  padding: '14px 16px',
                  zIndex: isSelected ? 10 : 2,
                  cursor: activeTool === 'select' ? 'move' : 'pointer',
                  userSelect: 'none',
                  transition: draggingNodeId === node.id ? 'none' : 'box-shadow 0.2s, border-color 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        width: '30px',
                        height: '30px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {renderIcon(node.iconName)}
                    </div>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {node.type}
                    </span>
                  </div>

                  {isNodeRunning && (
                    <span style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 600 }}>Ativo…</span>
                  )}
                  {isSuccess && (
                    <span style={{ fontSize: '0.72rem', color: '#4ade80', fontWeight: 600 }}>Concluído</span>
                  )}
                </div>

                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {node.title}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {node.subtitle}
                </div>

                <div
                  style={{
                    position: 'absolute',
                    right: '-6px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: isSelected ? 'var(--accent-light)' : 'var(--text-muted)',
                    border: '2px solid var(--bg-primary)',
                  }}
                  title="Conectar a outro nó"
                />
                <div
                  style={{
                    position: 'absolute',
                    left: '-6px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: 'var(--text-muted)',
                    border: '2px solid var(--bg-primary)',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Floating Bottom Toolbar Capsule */}
        <div
          style={{
            position: 'absolute',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '6px 12px',
            boxShadow: 'var(--shadow-panel)',
            userSelect: 'none',
            maxWidth: 'calc(100% - 24px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              onClick={handleZoomOut}
              className="btn btn-ghost btn-icon-sm"
              title="Reduzir zoom"
              aria-label="Reduzir zoom"
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="btn btn-ghost btn-xs jarvis-tabular"
              title="Restaurar 100%"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="btn btn-ghost btn-icon-sm"
              title="Aumentar zoom"
              aria-label="Aumentar zoom"
            >
              <ZoomIn size={15} />
            </button>
          </div>

          <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-color)', margin: '0 2px' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <button
              type="button"
              onClick={() => setActiveTool('select')}
              className={`btn btn-icon-sm ${activeTool === 'select' ? 'btn-secondary is-active' : 'btn-ghost'}`}
              title="Ponteiro / Seleção"
              aria-label="Ponteiro / Seleção"
            >
              <MousePointer2 size={15} />
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('pan')}
              className={`btn btn-icon-sm ${activeTool === 'pan' ? 'btn-secondary is-active' : 'btn-ghost'}`}
              title="Mão / Arrastar Canvas"
              aria-label="Mão / Arrastar Canvas"
            >
              <Hand size={15} />
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('draw')}
              className={`btn btn-icon-sm ${activeTool === 'draw' ? 'btn-secondary is-active' : 'btn-ghost'}`}
              title="Caneta / Rascunho"
              aria-label="Caneta / Rascunho"
            >
              <PenTool size={15} />
            </button>

            <button
              type="button"
              onClick={() => handleAddNode('note', 'Anotação / Post-it', 'Ideias de arquitetura', 'note')}
              className="btn btn-ghost btn-icon-sm"
              title="Adicionar Post-it"
              aria-label="Adicionar Post-it"
            >
              <StickyNote size={15} />
            </button>

            <button
              type="button"
              onClick={() => handleAddNode('agent', 'Novo Agente', 'Execução autônoma', 'bot')}
              className="btn btn-ghost btn-icon-sm"
              title="Adicionar Agente Especialista"
              aria-label="Adicionar Agente Especialista"
            >
              <SquareCode size={15} />
            </button>
          </div>

          <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-color)', margin: '0 2px' }} />

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setAddNodeMenuOpen(!addNodeMenuOpen)}
              className="btn btn-primary btn-sm"
            >
              <Plus size={14} />
              <span>Adicionar nó</span>
            </button>

            {addNodeMenuOpen && (
              <div
                className="jarvis-popover"
                style={{
                  position: 'absolute',
                  bottom: '44px',
                  right: 0,
                  width: '240px',
                  zIndex: 60,
                }}
              >
                <div className="jarvis-popover__label">
                  Catálogo de Nós
                </div>
                <button
                  type="button"
                  onClick={() => handleAddNode('trigger', 'Webhook HTTP', 'Disparado por requisição POST externa', 'webhook')}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  <Webhook size={14} color="#4ade80" />
                  <span>Gatilho: Webhook</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddNode('trigger', 'Agendamento Cron', 'Execução periódica a cada intervalo', 'clock')}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  <Clock size={14} color="var(--accent-light)" />
                  <span>Gatilho: Agendamento</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddNode('agent', 'QA Tester Agent', 'Verificação de build e conformidade', 'bot')}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  <Bot size={14} color="var(--accent-light)" />
                  <span>Agente: QA Tester</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleAddNode('action', 'Telegram Notifier', 'Envia alerta ao canal configurado', 'sparkles')}
                  className="btn btn-ghost btn-sm btn-block btn-start"
                >
                  <Sparkles size={14} color="#fbbf24" />
                  <span>Ação: Alerta Telegram</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
