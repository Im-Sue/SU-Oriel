import type { ReactNode } from "react";
import { useLocation } from "react-router";

import styles from "./PageHeader.module.css";

interface PageHeaderProps {
  title: string;
  projectName: string | null;
  actions?: ReactNode;
}

interface CrumbSegment {
  label: string;
  path?: string;
}

function deriveCrumbs(pathname: string, projectName: string | null, fallbackTitle: string): CrumbSegment[] {
  const segs: CrumbSegment[] = [];
  if (projectName) segs.push({ label: projectName });

  if (pathname.startsWith("/overview")) segs.push({ label: "概览" });
  else if (pathname.startsWith("/my-work")) segs.push({ label: "我的工作" });
  else if (pathname.startsWith("/documents")) {
    segs.push({ label: "文档中心", path: "/documents" });
    if (pathname !== "/documents" && pathname.length > "/documents".length) {
      segs.push({ label: "文档详情" });
    }
  } else if (pathname.startsWith("/tasks")) {
    segs.push({ label: "任务看板", path: "/tasks" });
    if (pathname !== "/tasks" && pathname.length > "/tasks".length) {
      segs.push({ label: "任务详情" });
    }
  } else if (pathname.startsWith("/requirements")) {
    segs.push({ label: "需求管理", path: "/requirements" });
    if (pathname !== "/requirements" && pathname.length > "/requirements".length) {
      segs.push({ label: "需求详情" });
    }
  } else if (pathname.startsWith("/runs")) {
    segs.push({ label: "运行记录" });
  } else if (pathname.startsWith("/settings")) {
    segs.push({ label: "项目设置" });
  } else if (pathname.startsWith("/ai-cli")) {
    segs.push({ label: "AI CLI" });
  } else {
    segs.push({ label: fallbackTitle });
  }

  return segs;
}

export function PageHeader(props: PageHeaderProps) {
  const location = useLocation();
  const crumbs = deriveCrumbs(location.pathname, props.projectName, props.title);

  return (
    <header className={styles.pageHeader}>
      <nav aria-label="导航路径" className={styles.breadcrumb}>
        {crumbs.map((seg, idx) => (
          <span className={styles.crumbWrap} key={idx}>
            {idx > 0 ? <span aria-hidden="true" className={styles.sep}>/</span> : null}
            {seg.path ? (
              <a className={styles.crumbLink} href={seg.path}>
                {seg.label}
              </a>
            ) : (
              <span className={styles.crumbCurrent}>{seg.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className={styles.actions}>{props.actions}</div>
    </header>
  );
}
