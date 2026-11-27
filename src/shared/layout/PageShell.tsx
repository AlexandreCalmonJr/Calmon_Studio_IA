import React from 'react';
import { PageHeader } from './PageHeader';

interface PageShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const PageShell: React.FC<PageShellProps> = ({
  title,
  subtitle,
  icon,
  actions,
  children,
}) => {
  return (
    <div className="calmon-page-shell">
      <PageHeader title={title} subtitle={subtitle} icon={icon} actions={actions} />
      <div className="calmon-page-shell__body">{children}</div>
    </div>
  );
};
