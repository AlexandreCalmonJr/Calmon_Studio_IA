import React, { useState } from 'react';
import { Shield } from 'lucide-react';
import { ContainmentAuditSection } from './ContainmentAuditSection';
import { DevSecOpsSection } from './DevSecOpsSection';
import { PageHeader } from '../../shared/layout/PageHeader';

interface SecurityCenterViewProps {
  onRefresh: () => void;
}

export const SecurityCenterView: React.FC<SecurityCenterViewProps> = ({ onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'containment' | 'devsecops'>('containment');

  return (
    <div className="jarvis-page-shell">
      <PageHeader
        icon={<Shield size={18} />}
        title="Central de Segurança"
        subtitle="Governança de permissões, contenção de emergência, trilha de auditoria, CVEs e Red Team sandbox."
        actions={
          <div className="jarvis-segmented" role="tablist" aria-label="Módulos de segurança">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'containment'}
              onClick={() => setActiveTab('containment')}
              className={`jarvis-segmented-btn ${activeTab === 'containment' ? 'is-active' : ''}`}
            >
              Contenção & Auditoria
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'devsecops'}
              onClick={() => setActiveTab('devsecops')}
              className={`jarvis-segmented-btn ${activeTab === 'devsecops' ? 'is-active' : ''}`}
            >
              DevSecOps & CVEs
            </button>
          </div>
        }
      />

      {activeTab === 'containment' ? (
        <ContainmentAuditSection onRefresh={onRefresh} />
      ) : (
        <DevSecOpsSection />
      )}
    </div>
  );
};
