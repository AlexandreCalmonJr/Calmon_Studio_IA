import React from 'react';
import {
  Activity,
  AppWindow,
  BookOpen,
  Bot,
  Building2,
  CheckSquare,
  Code2,
  Compass,
  Cpu,
  FileBarChart2,
  FolderKanban,
  GitBranch,
  HelpCircle,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Palette,
  Radio,
  Server,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Terminal,
  TrendingUp,
  Wand2,
  Workflow,
  Wrench,
} from 'lucide-react';
import type { NavIconKey } from '../../services/navigationShell';

interface NavIconProps {
  iconKey: NavIconKey;
  size?: number;
  color?: string;
  className?: string;
}

export const NavIcon: React.FC<NavIconProps> = ({
  iconKey,
  size = 16,
  color,
  className,
}) => {
  switch (iconKey) {
    case 'overview':
      return <LayoutDashboard size={size} color={color} className={className} />;
    case 'chat':
      return <MessageSquare size={size} color={color} className={className} />;
    case 'creative_studio':
      return <Wand2 size={size} color={color} className={className} />;
    case 'office':
      return <Building2 size={size} color={color} className={className} />;
    case 'tasks':
      return <ListTodo size={size} color={color} className={className} />;
    case 'workflows':
      return <Workflow size={size} color={color} className={className} />;
    case 'agents':
      return <Bot size={size} color={color} className={className} />;
    case 'models':
      return <Cpu size={size} color={color} className={className} />;
    case 'knowledge':
      return <BookOpen size={size} color={color} className={className} />;
    case 'skills':
      return <Sparkles size={size} color={color} className={className} />;
    case 'workspace':
      return <FolderKanban size={size} color={color} className={className} />;
    case 'coding':
      return <Code2 size={size} color={color} className={className} />;
    case 'architecture':
      return <Compass size={size} color={color} className={className} />;
    case 'app_builder':
      return <AppWindow size={size} color={color} className={className} />;
    case 'github_import':
      return <GitBranch size={size} color={color} className={className} />;
    case 'android_app':
      return <Smartphone size={size} color={color} className={className} />;
    case 'brain_server':
      return <Server size={size} color={color} className={className} />;
    case 'companion':
      return <Radio size={size} color={color} className={className} />;
    case 'advisor':
      return <Activity size={size} color={color} className={className} />;
    case 'security':
      return <ShieldCheck size={size} color={color} className={className} />;
    case 'approvals':
      return <CheckSquare size={size} color={color} className={className} />;
    case 'usage':
      return <TrendingUp size={size} color={color} className={className} />;
    case 'backend_studio':
      return <Wrench size={size} color={color} className={className} />;
    case 'quality':
      return <CheckSquare size={size} color={color} className={className} />;
    case 'design':
      return <Palette size={size} color={color} className={className} />;
    case 'executive_report':
      return <FileBarChart2 size={size} color={color} className={className} />;
    case 'server_logs':
      return <Terminal size={size} color={color} className={className} />;
    case 'store':
      return <Store size={size} color={color} className={className} />;
    case 'pack_studio':
      return <Wrench size={size} color={color} className={className} />;
    case 'learning':
      return <HelpCircle size={size} color={color} className={className} />;
    case 'settings':
      return <Settings size={size} color={color} className={className} />;
    default:
      return <LayoutDashboard size={size} color={color} className={className} />;
  }
};

/**
 * Ícone 3×3 colorido no padrão macOS Launchpad para o Dock.
 */
export const LaunchpadGlyph: React.FC<{ size?: number }> = ({ size = 20 }) => {
  const colors = [
    '#f97316',
    '#f59e0b',
    '#22c55e',
    '#ec4899',
    '#6366f1',
    '#0ea5e9',
    '#8b5cf6',
    '#14b8a6',
    '#fb7185',
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {colors.map((fill, idx) => {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        return (
          <rect
            key={idx}
            x={3 + col * 6.5}
            y={3 + row * 6.5}
            width="5"
            height="5"
            rx="1.5"
            fill={fill}
          />
        );
      })}
    </svg>
  );
};
