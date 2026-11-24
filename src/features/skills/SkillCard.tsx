import React from 'react';
import {
  Users,
  CheckCircle,
  XCircle,
  Trash2,
  BookOpen,
  Wrench,
  ShieldCheck,
  Sparkles,
  FlaskConical,
} from 'lucide-react';
import { SkillInfo, AgentInfo } from '../../types';
import { ALL_26_AGENTS } from '../../data/agentsCatalog';
import { resolveSkillDomainLabel } from '../../services/domainCatalog';
import { classifySkillBucket, isCustomSkill } from '../../services/unifiedStoreEngine';

interface SkillCardProps {
  skill: SkillInfo;
  agents?: AgentInfo[];
  onToggle: (id: string) => void;
  onEditAgents: (skill: SkillInfo) => void;
  onViewInstructions?: (skill: SkillInfo) => void;
  onDelete?: (id: string, name: string) => void;
  canManageSkills?: boolean;
  isAdmin?: boolean;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  agents = [],
  onToggle,
  onEditAgents,
  onViewInstructions,
  onDelete,
  canManageSkills = false,
  isAdmin = false,
}) => {
  const isApproved = skill.is_approved && !skill.is_revoked;
  const isPrivateSkill = isCustomSkill(skill);
  const canManageThisSkill = canManageSkills && (isAdmin || isPrivateSkill);

  const domainLabel = resolveSkillDomainLabel(skill.domain);
  const originLabel =
    skill.origin && (skill.origin.includes('github') || skill.origin === 'imported_ecc')
      ? 'ECC Oficial'
      : isPrivateSkill
        ? 'Custom'
        : null;

  const bucket = classifySkillBucket(skill);
  const iconTone =
    bucket === 'sec'
      ? { bg: 'var(--success-soft)', color: 'var(--success-text)', border: 'rgba(34, 197, 94, 0.28)', Icon: ShieldCheck }
      : bucket === 'qa'
        ? { bg: 'var(--info-soft)', color: 'var(--info-text)', border: 'rgba(56, 189, 248, 0.28)', Icon: FlaskConical }
        : bucket === 'custom'
          ? { bg: 'var(--purple-soft)', color: 'var(--purple-text)', border: 'rgba(139, 92, 246, 0.28)', Icon: Sparkles }
          : { bg: 'var(--accent-soft)', color: 'var(--accent-light)', border: 'var(--border-accent)', Icon: BookOpen };

  const DomainIcon = iconTone.Icon;

  const assigned = (skill.assigned_agents || []).map((role) => {
    const liveAg = agents.find((a) => a.role === role);
    if (liveAg) {
      return {
        role: liveAg.role,
        name: liveAg.proper_name || liveAg.name,
        color: liveAg.mascot?.color || 'var(--accent-color)',
        categoryLabel: liveAg.name || 'Especialista',
      };
    }
    const ag = ALL_26_AGENTS.find((a) => a.role === role);
    return (
      ag || {
        role,
        name: role.replace(/_/g, ' '),
        color: 'var(--accent-color)',
        categoryLabel: 'Especialista',
      }
    );
  });

  const visibleAvatars = assigned.slice(0, 3);
  const remainingCount = Math.max(0, assigned.length - 3);

  return (
    <article className={`jarvis-store-card ${isApproved ? 'is-installed' : ''}`}>
      {/* Header: Icon Badge + Name/Subtitle + Uppercase Status */}
      <div className="jarvis-store-card__header">
        <div className="jarvis-store-card__identity">
          <div
            className="jarvis-store-icon-badge"
            style={{
              backgroundColor: iconTone.bg,
              borderColor: iconTone.border,
              color: iconTone.color,
            }}
            aria-hidden="true"
          >
            <DomainIcon size={18} />
          </div>
          <div className="jarvis-store-card__titles">
            <h3 className="jarvis-store-card__title">{skill.name}</h3>
            <div className="jarvis-store-card__subtitle">
              {domainLabel} · v{skill.version}
              {originLabel ? ` · ${originLabel}` : ''}
            </div>
          </div>
        </div>

        <span className={`jarvis-store-card__badge ${isApproved ? 'is-active' : ''}`}>
          {isApproved ? 'ATIVA' : 'INATIVA'}
        </span>
      </div>

      {/* Description */}
      <p className="jarvis-store-card__desc">{skill.description}</p>

      {/* Compact Meta Strip (Specialists + Tools) */}
      <div className="jarvis-store-card__meta-line">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
          {visibleAvatars.length > 0 && (
            <div style={{ display: 'inline-flex', alignItems: 'center' }}>
              {visibleAvatars.map((ag, i) => (
                <span
                  key={ag.role}
                  title={`${ag.name} (${'categoryLabel' in ag && ag.categoryLabel ? ag.categoryLabel : 'Especialista'})`}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '6px',
                    backgroundColor: ag.color || 'var(--accent-color)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    marginLeft: i > 0 ? '-5px' : 0,
                    border: '1.5px solid var(--bg-secondary)',
                  }}
                >
                  {ag.name.charAt(0)}
                </span>
              ))}
              {remainingCount > 0 && (
                <span
                  className="jarvis-tabular"
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-tertiary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-secondary)',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    marginLeft: '-5px',
                    border: '1.5px solid var(--bg-secondary)',
                  }}
                >
                  +{remainingCount}
                </span>
              )}
            </div>
          )}
          <span className="jarvis-tabular">
            {assigned.length} {assigned.length === 1 ? 'especialista' : 'especialistas'}
          </span>
        </div>

        {skill.allowed_tools && skill.allowed_tools.length > 0 && (
          <span
            className="jarvis-tabular"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
            }}
            title={skill.allowed_tools.join(', ')}
          >
            <Wrench size={11} />
            <span>{skill.allowed_tools.length} MCP</span>
          </span>
        )}
      </div>

      {/* Footer Actions */}
      <div className="jarvis-store-card__footer">
        {canManageThisSkill ? (
          <button
            type="button"
            onClick={() => onToggle(skill.id)}
            aria-pressed={isApproved}
            className="btn btn-secondary btn-sm jarvis-store-card__primary-btn"
            title={isApproved ? 'Habilidade ativa — clique para desativar' : 'Habilidade inativa — clique para ativar'}
          >
            {isApproved ? <CheckCircle size={13} color="var(--success-color)" /> : <XCircle size={13} />}
            <span>{isApproved ? 'Ativa · Desativar' : 'Ativar habilidade'}</span>
          </button>
        ) : onViewInstructions ? (
          <button
            type="button"
            onClick={() => onViewInstructions(skill)}
            className="btn btn-secondary btn-sm jarvis-store-card__primary-btn"
          >
            <BookOpen size={13} />
            <span>Ver diretrizes</span>
          </button>
        ) : null}

        {canManageThisSkill && onViewInstructions && (
          <button
            type="button"
            onClick={() => onViewInstructions(skill)}
            className="btn btn-ghost btn-sm jarvis-store-card__secondary-btn"
            title="Ver diretrizes e instruções de prompt"
          >
            <span>Diretrizes</span>
          </button>
        )}

        {canManageThisSkill && (
          <button
            type="button"
            onClick={() => onEditAgents(skill)}
            className="btn btn-ghost btn-sm jarvis-store-card__secondary-btn"
            title="Vincular agentes especialistas"
          >
            <Users size={13} />
            <span>Vincular</span>
          </button>
        )}

        {onDelete && canManageThisSkill && isPrivateSkill && (
          <button
            type="button"
            onClick={() => onDelete(skill.id, skill.name)}
            className="btn btn-danger-ghost btn-icon-sm"
            title={`Excluir habilidade ${skill.name}`}
            aria-label={`Excluir habilidade ${skill.name}`}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </article>
  );
};
