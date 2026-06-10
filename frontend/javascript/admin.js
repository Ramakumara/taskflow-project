const adminState = {
    users: [],
    projects: [],
    tasks: [],
    rawNotifications: [],
    notifications: [],
    notificationFilter: "all",
    dashboardStats: null,
    searchTerm: "",
    currentSection: "dashboard",
    isUserModalOpen: false,
    isCreatingUser: false,
    isInviteModalOpen: false,
    isSendingInvitation: false,
    inviteUserForm: {
        email: "",
        role: "User"
    },
    isProjectModalOpen: false,
    isCreatingProject: false,
    isTaskModalOpen: false,
    isCreatingTask: false,
    newUserForm: {
        username: "",
        email: "",
        role: "user"
    },
    newProjectForm: {
        name: "",
        description: "",
        assigned_manager: "",
        start_date: "",
        end_date: "",
        status: "Planning"
    },
    newTaskForm: {
        projectId: "",
        title: "",
        description: "",
        priority: "Medium",
        assignedTo: [],
        deadline: "",
        attachments: []
    }
};
const ADMIN_STATUS_COLOR_FALLBACKS = {
    pending: "#f59e0b",
    progress: "#2563eb",
    completed: "#16a34a",
    hold: "#d92d20",
    planning: "#9333ea"
};

function getAdminStatusColorToken(name) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--status-${name}`).trim();
    return value || ADMIN_STATUS_COLOR_FALLBACKS[name] || ADMIN_STATUS_COLOR_FALLBACKS.pending;
}

let projectStatusChart = null;
let taskOverviewChart = null;
let adminReportStatusChart = null;
let adminReportProjectChart = null;
let adminNotificationClock = null;
let adminThemeMediaQuery = null;
let adminThemeMediaQueryHandlerBound = false;
let adminFileUploadSelectedFile = null;
let adminFileUploadSelectedAssignees = [];

const adminReportState = {
    startDate: "",
    endDate: "",
    filteredProjects: [],
    filteredTasks: [],
    showAllProjects: false,
    showAllActivity: false
};
const adminTaskFilters = {
    projectId: "all",
    status: "all",
    page: 1,
    pageSize: 5,
    priority: "all",
    due: "all",
    sort: "newest"
};
let selectedAdminTaskId = sessionStorage.getItem("taskflow.adminSelectedTaskId") || null;
let adminTaskDetailOpen = false;
let adminTaskEditMode = false;
let adminTaskInboxScrollTop = Number(sessionStorage.getItem("taskflow.adminTaskInboxScrollTop") || 0);
const selectedAdminTaskIds = new Set();
const adminUserFilters = {
    page: 1,
    pageSize: 5,
    role: "all"
};
const adminTeamFilters = {
    projectId: "all"
};
const adminFileFilters = {
    category: "all",
    sort: "date-desc",
    page: 1,
    pageSize: 6
};
const ADMIN_NOTIFICATION_FILTERS = ["all", "unread", "projects", "tasks", "users", "files", "system"];
let expandedAdminTaskAssigneeCards = {};
let expandedAdminTeamProjects = {};
const expandedAdminFileAssigneeRows = new Set();
let adminFileAssigneePopoverBound = false;
let activeAdminFileAssigneePreview = null;

function getManagerUsers() {
    const teamId = String(sessionStorage.getItem("team_id") || "").trim();
    return adminState.users.filter((user) => {
        const isManager = String(user.role || "").toLowerCase() === "manager";
        return isManager && (!teamId || !user.team_id || String(user.team_id) === teamId);
    });
}

function getTaskAssignments(task) {
    if (Array.isArray(task?.assignments)) return task.assignments;
    if (Array.isArray(task?.assigned_statuses)) return task.assigned_statuses;

    const assigned = Array.isArray(task?.assigned_to)
        ? task.assigned_to
        : (task?.assigned_to ? [task.assigned_to] : []);

    return assigned.map(email => ({
        user_id: email,
        status: normalizeStatusLabel(task?.status)
    }));
}

function getTaskMembers(task) {
    return getTaskAssignments(task).map(assignment => String(assignment.user_id || "").trim()).filter(Boolean);
}

function isAdminTaskAssigneeCardExpanded(taskId) {
    return Boolean(expandedAdminTaskAssigneeCards[String(taskId || "")]);
}

function toggleAdminTaskAssigneeCard(taskId) {
    const key = String(taskId || "");
    if (!key) return;

    expandedAdminTaskAssigneeCards[key] = !isAdminTaskAssigneeCardExpanded(key);
    renderTasksView();
}

function renderAdminMemberStatuses(task) {
    const assignments = getTaskAssignments(task);
    if (!assignments.length) return `<span class="muted-text">Unassigned</span>`;
    const baseVisibleCount = 1;
    const isExpanded = isAdminTaskAssigneeCardExpanded(task?.id);
    const visibleAssignments = assignments.slice(0, isExpanded ? assignments.length : baseVisibleCount);
    const hiddenAssignments = assignments.slice(visibleAssignments.length);

    return `
        <div class="admin-task-assignee-card">
            ${visibleAssignments.map(assignment => {
                const email = assignment.user_id || "Unassigned";
                const status = normalizeStatusLabel(assignment.status);
                const name = getAdminUserDisplayName(email);
                return `
                    <div class="admin-task-assignee-row" title="${escapeHtml(email)}: ${escapeHtml(status)}">
                        <span class="admin-task-avatar">${escapeHtml(getInitial(name || email))}</span>
                        <span class="admin-task-name">${escapeHtml(name)}</span>
                        <span class="admin-member-status ${statusClassName(status)}">
                            <i></i>${escapeHtml(status)}
                        </span>
                    </div>
                `;
            }).join("")}
            ${hiddenAssignments.length ? `
                <button class="admin-task-more" type="button" onclick="toggleAdminTaskAssigneeCard('${task.id}')">+ ${hiddenAssignments.length} more</button>
            ` : ""}
            ${!hiddenAssignments.length && isExpanded && assignments.length > baseVisibleCount ? `
                <button class="admin-task-more" type="button" onclick="toggleAdminTaskAssigneeCard('${task.id}')">Show less</button>
            ` : ""}
        </div>
    `;
}

function getAdminUserDisplayName(email) {
    const lookup = String(email || "").trim().toLowerCase();
    const user = adminState.users.find(item => String(item.email || "").trim().toLowerCase() === lookup);
    return user?.username || String(email || "Unassigned").split("@")[0] || "Unassigned";
}

function getInitial(value) {
    return String(value || "?").trim().charAt(0).toUpperCase() || "?";
}

function getTaskMemberStatusSearchText(task) {
    return getTaskAssignments(task)
        .map(assignment => `${assignment.user_id || ""} ${normalizeStatusLabel(assignment.status)}`)
        .join(" ");
}

function initializeAdminDashboard() {
    setProfileAvatar();
    applyAdminSettingsPreferences();
    bindAdminThemePreference();
    startAdminNotificationClock();
    refreshAdminData().then(() => {
        renderCurrentSection();
    });
    loadAdminNotifications();
    attachAdminMenuCloseHandler();
    setInterval(() => {
        if (document.documentElement.dataset.realtimeStatus !== "connected") {
            loadAdminNotifications();
        }
    }, 60000);
}

async function refreshAdminData() {
    const token = sessionStorage.getItem("token");

    try {
        const [usersRes, projectsRes, tasksRes, statsRes] = await Promise.all([
            fetch(`${BASE_URL}/users`, {
                headers: {
                    "Authorization": "Bearer " + token
                }
            }),
            fetch(`${BASE_URL}/projects`, {
                headers: {
                    "Authorization": "Bearer " + token
                }
            }),
            fetch(`${BASE_URL}/tasks`, {
                headers: {
                    "Authorization": "Bearer " + token
                }
            }),
            fetch(`${BASE_URL}/admin/dashboard-stats`, {
                headers: {
                    "Authorization": "Bearer " + token
                }
            })
        ]);

        adminState.users = await usersRes.json();
        adminState.projects = await projectsRes.json();
        adminState.tasks = await tasksRes.json();
        adminState.dashboardStats = statsRes.ok ? await statsRes.json().catch(() => null) : null;
        if (adminState.rawNotifications.length) {
            adminState.notifications = buildAdminNotificationFeed(adminState.rawNotifications);
            renderAdminNotifications();
        }
        updateNotificationCount();
    } catch (error) {
        console.error("Failed to load admin data", error);
        document.getElementById("mainContent").innerHTML = `
            <div class="data-panel">
                <h3>Unable to load dashboard</h3>
                <p>Please make sure the backend is running and try again.</p>
            </div>
        `;
    }
}

function setProfileAvatar() {
    const username = sessionStorage.getItem("username") || "Admin";
    const avatar = document.getElementById("profileAvatar");
    const encoded = encodeURIComponent(username);
    avatar.src = `https://ui-avatars.com/api/?name=${encoded}&background=16a34a&color=fff&bold=true`;
}

function handleAdminSearch(event) {
    adminState.searchTerm = String(event?.target?.value || "").trim().toLowerCase();
    adminTaskFilters.page = 1;
    adminUserFilters.page = 1;
    adminFileFilters.page = 1;
    renderCurrentSection();
}

function setActiveNav(section) {
    adminState.currentSection = section;
    document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.section === section);
    });
}

function renderCurrentSection() {
    switch (adminState.currentSection) {
        case "projects":
            renderProjectsView();
            break;
        case "tasks":
            renderTasksView();
            break;
        case "team":
            renderTeamView();
            break;
        case "users":
            renderUsersView();
            break;
        case "reports":
            renderReportsView();
            break;
        case "activity":
            renderActivityLogView();
            break;
        case "files":
            renderFilesView();
            break;
        case "profile":
            renderProfileView();
            break;
        case "settings":
            renderSettingsView();
            break;
        default:
            renderDashboardView();
            break;
    }
}

function goToDashboard() {
    closeAdminProfileMenu();
    setActiveNav("dashboard");
    renderDashboardView();
}

function goToProjects() {
    closeAdminProfileMenu();
    setActiveNav("projects");
    renderProjectsView();
}

function goToTasks() {
    closeAdminProfileMenu();
    setActiveNav("tasks");
    renderTasksView();
}

function goToTeam() {
    closeAdminProfileMenu();
    setActiveNav("team");
    renderTeamView();
}

function goToUsers() {
    closeAdminProfileMenu();
    setActiveNav("users");
    renderUsersView();
}

function goToReports() {
    closeAdminProfileMenu();
    setActiveNav("reports");
    renderReportsView();
}

function goToActivityLog() {
    closeAdminProfileMenu();
    setActiveNav("activity");
    renderActivityLogView();
}

function goToFiles() {
    closeAdminProfileMenu();
    setActiveNav("files");
    renderFilesView();
}

function goToProfile() {
    closeAdminProfileMenu();
    setActiveNav("profile");
    renderProfileView();
}

function goToSettings() {
    closeAdminProfileMenu();
    setActiveNav("settings");
    renderSettingsView();
}

function renderCommonPageLayout({ pageClass = "", header, toolbar = "", content = "" }) {
    return `
        <section class="common-page-card ${pageClass}">
            ${header}
            ${toolbar}
            ${content}
        </section>
    `;
}

function renderCommonPageHeader(title, subtitle, actionHtml = "", toolbarHtml = "") {
    return `
        <header class="common-page-header">
            <div class="common-page-title">
                <h1>${escapeHtml(title)}</h1>
                ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
            </div>
            ${actionHtml || toolbarHtml ? `<div class="common-page-header-actions">${toolbarHtml}${actionHtml}</div>` : ""}
        </header>
    `;
}

function renderCommonContentCard(content, extraClass = "") {
    return `<section class="common-content-card ${extraClass}">${content}</section>`;
}

function toggleAdminProfileMenu(event) {
    event.stopPropagation();
    const dropdown = document.getElementById("profileDropdown");
    const button = document.getElementById("profileMenuButton");
    const isHidden = dropdown.classList.contains("hidden");

    dropdown.classList.toggle("hidden", !isHidden);
    button.setAttribute("aria-expanded", String(isHidden));
}

function closeAdminProfileMenu() {
    const dropdown = document.getElementById("profileDropdown");
    const button = document.getElementById("profileMenuButton");

    if (!dropdown || !button) {
        return;
    }

    dropdown.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
}

function attachAdminMenuCloseHandler() {
    document.addEventListener("click", (event) => {
        const menu = document.querySelector(".profile-menu");
        if (menu && !menu.contains(event.target)) {
            closeAdminProfileMenu();
        }

        const notificationWrap = document.getElementById("adminNotificationWrap");
        if (notificationWrap && !notificationWrap.contains(event.target)) {
            closeAdminNotifications();
        }

        const fileAssigneeMenu = document.getElementById("admin-file-assignee-menu");
        const fileAssigneeTrigger = document.getElementById("admin-file-assignee-trigger");
        if (fileAssigneeMenu && fileAssigneeTrigger && !fileAssigneeMenu.classList.contains("hidden") && !fileAssigneeMenu.contains(event.target) && !fileAssigneeTrigger.contains(event.target)) {
            fileAssigneeMenu.classList.add("hidden");
        }

        const fileModal = document.getElementById("admin-file-upload-modal");
        if (fileModal && event.target === fileModal) {
            closeAdminFileUploadModal();
        }
    });
}

function logoutFromAdmin() {
    closeAdminProfileMenu();
    if (typeof logout === "function") {
        logout();
        return;
    }
    sessionStorage.clear();
    window.location.href = "/";
}

function loadAdminSettingsView() {
    const themeSelect = document.getElementById("admin-settings-theme-select");
    const languageSelect = document.getElementById("admin-settings-language-select");
    if (themeSelect) themeSelect.value = sessionStorage.getItem("settings.theme") || "light";
    if (languageSelect) {
        languageSelect.value = getSavedAdminLanguage();
    }    
    applyAdminSettingsPreferences();
}

function saveAdminSettingsPreference(key, value) {
    sessionStorage.setItem(`settings.${key}`, String(value));
    applyAdminSettingsPreferences();
}

function applyAdminGoogleLanguage(lang) {

    localStorage.setItem(
        "selectedLanguage",
        lang
    );
    sessionStorage.setItem(
        "settings.language",
        lang
    );

    document.cookie =
        "googtrans=/en/" + lang +
        ";path=/";

    document.cookie =
        "googtrans=/en/" + lang +
        ";domain=" +
        location.hostname +
        ";path=/";

    location.reload();
}

function getSavedAdminLanguage() {
    const savedPreference =
        String(sessionStorage.getItem("settings.language") || "").trim().toLowerCase();

    if (savedPreference === "hi" || savedPreference === "hindi") {
        return "hi";
    }

    if (savedPreference === "en" || savedPreference === "english") {
        return "en";
    }

    return localStorage.getItem("selectedLanguage") || "en";
}

function toggleAdminQuietNotifications() {
    const nextValue = sessionStorage.getItem("settings.quietNotifications") !== "true";
    saveAdminSettingsPreference("quietNotifications", nextValue);
}

function applyAdminSettingsPreferences() {
    const quietNotifications = sessionStorage.getItem("settings.quietNotifications") === "true";
    const theme = sessionStorage.getItem("settings.theme") || "light";
    const resolvedTheme = resolveAdminTheme(theme);

    document.body.classList.toggle("quiet-admin-notifications", quietNotifications);
    document.body.classList.toggle("admin-theme-dark", resolvedTheme === "dark");
    document.body.classList.toggle("theme-dark", resolvedTheme === "dark");
    document.documentElement.dataset.adminTheme = resolvedTheme;
    document.documentElement.dataset.theme = resolvedTheme;

    const notificationState = document.getElementById("admin-settings-notification-state");
    if (notificationState) {
        notificationState.textContent = quietNotifications ? "Muted" : "On";
        notificationState.classList.toggle("muted", quietNotifications);
    }
}

function resolveAdminTheme(theme) {
    if (theme === "system") {
        return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
}

function bindAdminThemePreference() {
    if (!window.matchMedia) {
        return;
    }

    if (!adminThemeMediaQuery) {
        adminThemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    }

    if (adminThemeMediaQueryHandlerBound) {
        return;
    }

    const handleThemePreferenceChange = () => {
        if ((sessionStorage.getItem("settings.theme") || "light") === "system") {
            applyAdminSettingsPreferences();
        }
    };

    if (typeof adminThemeMediaQuery.addEventListener === "function") {
        adminThemeMediaQuery.addEventListener("change", handleThemePreferenceChange);
    } else if (typeof adminThemeMediaQuery.addListener === "function") {
        adminThemeMediaQuery.addListener(handleThemePreferenceChange);
    }

    adminThemeMediaQueryHandlerBound = true;
}



function renderDashboardView() {
    const filteredProjects = filterCollection(adminState.projects, (project) => [
        project.name,
        project.description,
        project.owner_email
    ]);
    const projectStats = computeAdminProjectStats(filteredProjects);

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view project-admin-view">
            ${renderCommonPageLayout({
                pageClass: "admin-module-page admin-dashboard-page",
                header: renderCommonPageHeader(
                    "Dashboard",
                    "Track delivery health, open work, and project momentum from one consistent workspace.",
                    `
                        <button class="action-btn common-action-btn admin-add-user-btn" type="button" onclick="openAdminProjectModal()">
                            <i class="fas fa-plus"></i>
                            Create Project
                        </button>
                    `
                ),
                
                content: `
                    <section class="project-summary-grid">
                        ${renderAdminProjectStatCard("fa-folder", "Total Projects", projectStats.totalProjects, "green")}
                        ${renderAdminProjectStatCard("fa-list-check", "Total Tasks", projectStats.totalTasks, "mint")}
                        ${renderAdminProjectStatCard("fa-chart-line", "Completion Rate", `${projectStats.completionRate}%`, "emerald")}
                    </section>
                    ${renderCommonContentCard(`
                        <div class="project-board-head common-section-head">
                            <div class="common-page-title">
                                <h1>Projects</h1>
                            </div>
                        </div>
                        <div class="admin-project-grid">
                            ${filteredProjects.length ? filteredProjects.map((project) => renderProjectCard(project)).join("") : `<div class="project-empty-state">${adminState.searchTerm ? "No results found" : "No projects found."}</div>`}
                            <button class="admin-project-create-card" type="button" onclick="openAdminProjectModal()">
                                <span>+ Create Project</span>
                            </button>
                        </div>
                    `, "project-board-panel")}
                `
            })}
            ${adminState.isProjectModalOpen ? renderAdminProjectModal() : ""}
        </div>
    `;
}

function renderProjectsView() {
    const filteredProjects = filterCollection(adminState.projects, (project) => [
        project.name,
        project.description,
        project.owner_email
    ]);
    const projectStats = computeAdminProjectStats(filteredProjects);

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view project-admin-view">
            ${renderCommonPageLayout({
                pageClass: "admin-module-page admin-dashboard-page",
                header: renderCommonPageHeader(
                    "Dashboard",
                    "Track delivery health, open work, and project momentum from one consistent workspace.",
                    `
                        <button class="action-btn common-action-btn admin-add-user-btn" type="button" onclick="openAdminProjectModal()">
                            <i class="fas fa-plus"></i>
                            Create Project
                        </button>
                    `
                ),
                
                content: `
                    <section class="project-summary-grid">
                        ${renderAdminProjectStatCard("fa-folder", "Total Projects", projectStats.totalProjects, "green")}
                        ${renderAdminProjectStatCard("fa-list-check", "Total Tasks", projectStats.totalTasks, "mint")}
                        ${renderAdminProjectStatCard("fa-chart-line", "Completion Rate", `${projectStats.completionRate}%`, "emerald")}
                    </section>
                    ${renderCommonContentCard(`
                        <div class="project-board-head common-section-head">
                            <div class="common-page-title">
                                <h1>Projects</h1>
                            </div>
                        </div>
                        <div class="admin-project-grid">
                            ${filteredProjects.length ? filteredProjects.map((project) => renderProjectCard(project)).join("") : `<div class="project-empty-state">${adminState.searchTerm ? "No results found" : "No projects found."}</div>`}
                            <button class="admin-project-create-card" type="button" onclick="openAdminProjectModal()">
                                <span>+ Create Project</span>
                            </button>
                        </div>
                    `, "project-board-panel")}
                `
            })}
            ${adminState.isProjectModalOpen ? renderAdminProjectModal() : ""}
        </div>
    `;
}

function computeAdminProjectStats(projects) {
    const projectIds = new Set(projects.map((project) => String(project.id)));
    const relatedTasks = adminState.tasks.filter((task) => projectIds.has(String(task.project_id)));
    const completedTasks = relatedTasks.filter((task) => isCompletedStatus(task.status)).length;
    const completionRate = relatedTasks.length ? Math.round((completedTasks / relatedTasks.length) * 100) : 0;

    return {
        totalProjects: projects.length,
        totalTasks: relatedTasks.length,
        completionRate
    };
}

function renderAdminProjectStatCard(icon, label, value, accentClass) {
    return `
        <article class="admin-project-stat-card ${accentClass}">
            <span class="admin-project-stat-icon"><i class="fas ${icon}"></i></span>
            <div class="admin-project-stat-copy">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
            </div>
        </article>
    `;
}

function renderAdminProjectModal() {
    const managers = getManagerUsers();
    return `
        <div class="admin-modal-backdrop" onclick="handleAdminProjectBackdrop(event)">
    
            <div class="admin-modal-card admin-project-modal-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-project-title"
                onclick="event.stopPropagation()">

                <!-- Modal Header -->
                <div class="admin-modal-head">
                    <div>
                        <h3 id="admin-project-title">Create Project</h3>
                        <p>Add a new project for your team and start organizing tasks.</p>
                    </div>

                    <button class="admin-modal-close"
                        type="button"
                        aria-label="Close create project modal"
                        onclick="closeAdminProjectModal()">

                        <i class="fas fa-xmark"></i>
                    </button>
                </div>

                <!-- Form -->
                <form class="admin-user-form" onsubmit="submitAdminProject(event)">

                    <!-- Scrollable Body -->
                    <div class="admin-modal-body">

                        <div class="admin-user-form-section">

                            <!-- Project Name -->
                            <label class="admin-form-field">
                                <span>Project name <strong>*</strong></span>

                                <input
                                    id="admin-project-name"
                                    type="text"
                                    value="${escapeHtml(adminState.newProjectForm.name)}"
                                    oninput="updateAdminProjectField('name', this.value)"
                                    placeholder="Enter project name"
                                    maxlength="120"
                                    required>
                            </label>

                            <!-- Description -->
                            <label class="admin-form-field">
                                <span>Description</span>

                                <input
                                    id="admin-project-description"
                                    type="text"
                                    value="${escapeHtml(adminState.newProjectForm.description)}"
                                    oninput="updateAdminProjectField('description', this.value)"
                                    placeholder="Short description for the team"
                                    maxlength="220">
                            </label>

                            <!-- Manager -->
                            <label class="admin-form-field">
                                <span>Assign manager <strong>*</strong></span>

                                <div class="admin-task-user-list admin-project-manager-list" id="adminProjectManagerList">
                                    ${managers.length ? managers.map((manager) => {
                                        const managerEmail = String(manager.email || "").trim();
                                        const managerName = String(manager.username || manager.email || "Manager").trim();
                                        const searchValue = `${managerName.toLowerCase()} ${managerEmail.toLowerCase()}`;
                                        const checked = adminState.newProjectForm.assigned_manager === managerEmail ? "checked" : "";

                                        return `
                                            <label class="admin-task-user-option admin-project-manager-option" data-manager-search="${escapeHtml(searchValue)}">
                                                <input
                                                    type="radio"
                                                    name="admin-project-manager-choice"
                                                    value="${escapeHtml(managerEmail)}"
                                                    ${checked}
                                                    onchange="selectAdminProjectManager('${escapeHtml(managerEmail)}')">
                                                <span>${escapeHtml(managerName)}</span>
                                                <small>${escapeHtml(managerEmail)}</small>
                                            </label>
                                        `;
                                    }).join("") : `<div class="admin-task-user-empty admin-project-manager-empty">No managers available</div>`}
                                </div>
                            </label>

                            <!-- Start Date -->
                            <label class="admin-form-field">
                                <span>Start date</span>

                                <input
                                    id="admin-project-start-date"
                                    type="date"
                                    value="${escapeHtml(adminState.newProjectForm.start_date)}"
                                    oninput="updateAdminProjectField('start_date', this.value)"
                                    onchange="updateAdminProjectField('start_date', this.value)">
                            </label>

                            <!-- End Date -->
                            <label class="admin-form-field">
                                <span>End date</span>

                                <input
                                    id="admin-project-end-date"
                                    type="date"
                                    value="${escapeHtml(adminState.newProjectForm.end_date)}"
                                    oninput="updateAdminProjectField('end_date', this.value)"
                                    onchange="updateAdminProjectField('end_date', this.value)">
                            </label>

                        </div>

                    </div>

                    <!-- Footer -->
                    <div class="admin-modal-actions">

                        <button
                            class="action-btn secondary-btn"
                            type="button"
                            onclick="closeAdminProjectModal()">

                            Cancel
                        </button>

                        <button
                            class="action-btn admin-add-user-btn"
                            type="submit"
                            ${adminState.isCreatingProject ? "disabled" : ""}>

                            <i class="fas fa-plus"></i>

                            ${adminState.isCreatingProject ? "Creating..." : "Create Project"}
                        </button>

                    </div>

                </form>

            </div>

        </div>
    `;
}

function openAdminProjectModal() {
    adminState.newProjectForm = {
        name: "",
        description: "",
        assigned_manager: "",
        start_date: "",
        end_date: "",
        status: "Planning"
    };
    adminState.isProjectModalOpen = true;
    renderProjectsView();
}

function closeAdminProjectModal() {
    adminState.isProjectModalOpen = false;
    adminState.isCreatingProject = false;
    adminState.newProjectForm = {
        name: "",
        description: "",
        assigned_manager: "",
        start_date: "",
        end_date: "",
        status: "Planning"
    };
    renderProjectsView();
}

function handleAdminProjectBackdrop(event) {
    if (event.target.classList.contains("admin-modal-backdrop")) {
        closeAdminProjectModal();
    }
}

function updateAdminProjectField(field, value) {
    if (!(field in adminState.newProjectForm)) return;
    adminState.newProjectForm[field] = value;
}

function selectAdminProjectManager(email) {
    updateAdminProjectField("assigned_manager", String(email || "").trim());
}

function filterAdminProjectManagers(value) {
    const query = String(value || "").trim().toLowerCase();
    document.querySelectorAll(".admin-project-manager-option").forEach((option) => {
        const haystack = String(option.dataset.managerSearch || "").toLowerCase();
        option.style.display = !query || haystack.includes(query) ? "" : "none";
    });
}

async function submitAdminProject(event) {
    if (event) event.preventDefault();
    if (adminState.isCreatingProject) return;

    const token = sessionStorage.getItem("token");
    const rawName = String(document.getElementById("admin-project-name")?.value || adminState.newProjectForm.name || "").trim();
    const description = String(document.getElementById("admin-project-description")?.value || adminState.newProjectForm.description || "").trim();
    const selectedManagerInput = document.querySelector('input[name="admin-project-manager-choice"]:checked');
    const assignedManager = String(selectedManagerInput?.value || adminState.newProjectForm.assigned_manager || "").trim();
    const startDate = String(document.getElementById("admin-project-start-date")?.value || adminState.newProjectForm.start_date || "").trim();
    const endDate = String(document.getElementById("admin-project-end-date")?.value || adminState.newProjectForm.end_date || "").trim();
    const status = String(document.getElementById("admin-project-status")?.value || adminState.newProjectForm.status || "Planning").trim();
    const name = rawName.replace(/^./, (char) => char.toUpperCase());

    adminState.newProjectForm = {
        name,
        description,
        assigned_manager: assignedManager,
        start_date: startDate,
        end_date: endDate,
        status
    };

    if (!name) {
        showNotification("Project name is required.", "warning");
        return;
    }
    if (!assignedManager) {
        showNotification("Please assign a manager before creating the project.", "warning");
        return;
    }
    if (startDate && endDate && startDate > endDate) {
        showNotification("End date must be after start date.", "warning");
        return;
    }

    adminState.isCreatingProject = true;
    renderProjectsView();

    try {
        const response = await fetch(`${BASE_URL}/projects`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                name,
                project_name: name,
                description,
                assigned_manager: assignedManager || null,
                start_date: startDate || null,
                end_date: endDate || null,
                status
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || data.detail || "Unable to create project.");
        }

        const createdProject = data?.project || null;
        const createdProjectId = createdProject?.id;
        const normalizedAssignedManager = assignedManager.toLowerCase();
        const normalizedSavedManager = String(createdProject?.assigned_manager || "").trim().toLowerCase();

        if (createdProjectId && normalizedAssignedManager && normalizedSavedManager !== normalizedAssignedManager) {
            const assignResponse = await fetch(`${BASE_URL}/projects/${encodeURIComponent(createdProjectId)}/assign-manager`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
                body: JSON.stringify({
                    assigned_manager: assignedManager
                })
            });

            const assignData = await assignResponse.json().catch(() => ({}));
            if (!assignResponse.ok) {
                throw new Error(assignData.message || assignData.detail || "Project was created, but manager assignment failed.");
            }
        }

        showNotification(data.message || `Project "${name}" created successfully.`);
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(`New Project Created: ${name}`);
        }
        await refreshAdminData();
        closeAdminProjectModal();
    } catch (error) {
        console.error("Failed to create project", error);
        adminState.isCreatingProject = false;
        renderProjectsView();
        showNotification(error.message || "Unable to create project.", "error");
    }
}

function renderTasksView() {
    const stats = computeDashboardStats();
    const tasks = getFilteredAdminTasks(stats);
    const totalPages = Math.max(Math.ceil(tasks.length / adminTaskFilters.pageSize), 1);
    adminTaskFilters.page = Math.min(Math.max(adminTaskFilters.page, 1), totalPages);
    const startIndex = (adminTaskFilters.page - 1) * adminTaskFilters.pageSize;
    const pageTasks = tasks.slice(startIndex, startIndex + adminTaskFilters.pageSize);
    if (selectedAdminTaskId && !adminState.tasks.some((task) => String(task.id) === String(selectedAdminTaskId))) {
        selectedAdminTaskId = null;
        adminTaskDetailOpen = false;
        sessionStorage.removeItem("taskflow.adminSelectedTaskId");
    }
    const projectOptions = stats.filteredProjects.map(project => `
        <option value="${escapeHtml(project.id)}" ${String(adminTaskFilters.projectId) === String(project.id) ? "selected" : ""}>
            ${escapeHtml(project.name || "Untitled Project")}
        </option>
    `).join("");

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view task-management-view">
            ${renderCommonPageLayout({
                pageClass: "admin-module-page admin-tasks-page",
                header: renderCommonPageHeader(
                    "Tasks",
                    "Track assignments, due dates, and progress across your workspace.",
                    "",
                    adminTaskDetailOpen ? "" : `
                        <div class="common-toolbar">
                            <select class="admin-task-filter common-filter-select" onchange="setAdminTaskProjectFilter(this.value)" aria-label="Filter tasks by project">
                                <option value="all">All Projects</option>
                                ${projectOptions}
                            </select>
                            <select class="admin-task-filter common-filter-select" onchange="setAdminTaskStatusFilter(this.value)" aria-label="Filter tasks by status">
                                <option value="all" ${adminTaskFilters.status === "all" ? "selected" : ""}>All Status</option>
                                <option value="Pending" ${adminTaskFilters.status === "Pending" ? "selected" : ""}>Pending</option>
                                <option value="In Progress" ${adminTaskFilters.status === "In Progress" ? "selected" : ""}>In Progress</option>
                                <option value="Completed" ${adminTaskFilters.status === "Completed" ? "selected" : ""}>Completed</option>
                                <option value="On Hold" ${adminTaskFilters.status === "On Hold" ? "selected" : ""}>On Hold</option>
                                <option value="Planning" ${adminTaskFilters.status === "Planning" ? "selected" : ""}>Planning</option>
                            </select>
                            <select class="admin-task-filter common-filter-select" onchange="setAdminTaskDueFilter(this.value)" aria-label="Filter tasks by due date">
                                <option value="all" ${adminTaskFilters.due === "all" ? "selected" : ""}>Any Due Date</option>
                                <option value="overdue" ${adminTaskFilters.due === "overdue" ? "selected" : ""}>Overdue</option>
                                <option value="today" ${adminTaskFilters.due === "today" ? "selected" : ""}>Due Today</option>
                                <option value="week" ${adminTaskFilters.due === "week" ? "selected" : ""}>Due This Week</option>
                                <option value="none" ${adminTaskFilters.due === "none" ? "selected" : ""}>No Due Date</option>
                            </select>
                            <button class="action-btn common-action-btn admin-add-user-btn" type="button" onclick="openAdminTaskModal()">
                                <i class="fas fa-plus"></i>
                                Add Task
                            </button>
                        </div>
                    `
                ),
                content: renderCommonContentCard(`
                    <div class="admin-task-inbox-shell ${adminTaskDetailOpen ? "showing-detail" : ""}">
                        <div class="admin-task-inbox-left">
                            <div id="adminTasksInboxList" class="admin-task-inbox-list" tabindex="0" aria-label="Admin task inbox">
                                ${pageTasks.length ? pageTasks.map((task) => renderAdminTaskCard(task, stats.projectMap)).join("") : renderAdminTaskEmptyList()}
                            </div>
                            <div class="admin-task-footer">
                                <span class="app-pagination-summary">${tasks.length ? `Showing ${startIndex + 1} to ${startIndex + pageTasks.length} of ${tasks.length} tasks` : "Showing 0 tasks"}</span>
                                <div class="admin-task-pagination-controls app-pagination-controls">
                                    <button class="admin-task-page-btn app-page-btn" type="button" onclick="setAdminTaskPage(${adminTaskFilters.page - 1})" ${adminTaskFilters.page <= 1 ? "disabled" : ""} aria-label="Previous task page">
                                        <i class="fas fa-chevron-left"></i>
                                    </button>
                                    <span class="admin-task-page-current app-page-current">${adminTaskFilters.page}</span>
                                    <button class="admin-task-page-btn app-page-btn" type="button" onclick="setAdminTaskPage(${adminTaskFilters.page + 1})" ${adminTaskFilters.page >= totalPages ? "disabled" : ""} aria-label="Next task page">
                                        <i class="fas fa-chevron-right"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <aside class="admin-task-detail-panel" aria-live="polite">
                            ${adminTaskDetailOpen ? renderAdminTaskDetail(stats.projectMap) : ""}
                        </aside>
                    </div>
                `, "task-table-panel")
            })}
            ${adminState.isTaskModalOpen ? renderAdminTaskModal(stats.filteredProjects) : ""}
        </div>
    `;
    restoreAdminTaskInboxScroll();
}

function getFilteredAdminTasks(stats = computeDashboardStats()) {
    const searchedTasks = filterCollection(stats.filteredTasks, (task) => [
        task.title,
        task.description,
        getTaskMemberStatusSearchText(task),
        normalizeStatusLabel(task.status),
        normalizeTaskPriority(task.priority),
        stats.projectMap.get(String(task.project_id))?.name
    ]);

    return searchedTasks
        .filter((task) => {
            if (adminTaskFilters.projectId !== "all" && String(task.project_id) !== String(adminTaskFilters.projectId)) return false;
            if (adminTaskFilters.status !== "all" && normalizeStatusLabel(task.status) !== adminTaskFilters.status) return false;
            if (adminTaskFilters.priority !== "all" && normalizeTaskPriority(task.priority) !== adminTaskFilters.priority) return false;
            if (!adminTaskMatchesDueFilter(task, adminTaskFilters.due)) return false;
            return true;
        })
        .sort((a, b) => compareAdminTasks(a, b, adminTaskFilters.sort));
}

function renderAdminTaskCard(task, projectMap) {
    const project = projectMap.get(String(task.project_id));
    const status = normalizeStatusLabel(task.status);
    const statusClass = statusClassName(task.status);
    const priority = normalizeTaskPriority(task.priority);
    const priorityClass = priority.toLowerCase().replace(/\s+/g, "-");
    const attachments = getAdminTaskAttachments(task);
    const selected = String(task.id) === String(selectedAdminTaskId) ? "selected" : "";

    return `
        <article class="admin-task-card ${selected}" role="button" tabindex="0" data-task-id="${escapeHtml(task.id)}" onclick="openAdminTaskDetail('${escapeHtml(task.id)}')" onkeydown="handleAdminTaskCardKeydown(event, '${escapeHtml(task.id)}')">
            <div class="admin-task-card-controls" onclick="event.stopPropagation()">
                <button class="admin-task-card-star" type="button" onclick="toggleStar(this)" aria-label="Mark important">
                    <i class="far fa-star"></i>
                </button>
            </div>
            <div class="admin-task-card-main">
                <div class="admin-task-card-title-row">
                    <strong>${escapeHtml(task.title || "Untitled Task")}</strong>
                    <span>${escapeHtml(formatCreatedDate(task.created_at || task.createdAt))}</span>
                </div>
                <p>${escapeHtml(getAdminTaskPreview(task.description || "No description added."))}</p>
                <div class="admin-task-card-meta">
                    <span class="admin-task-card-project">${escapeHtml(project?.name || "Unknown Project")}</span>
                    <span class="admin-task-card-avatars">${renderAdminTaskAvatarStack(task)}</span>
                    <span class="task-priority-pill ${priorityClass}">${escapeHtml(priority)}</span>
                    <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
                    ${attachments.length ? `<span class="admin-task-attachment-indicator"><i class="fas fa-paperclip"></i>${attachments.length}</span>` : ""}
                </div>
            </div>
        </article>
    `;
}

function formatCreatedDate(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).replace(",", "");
}

function renderAdminTaskEmptyList() {
    return `
        <div class="admin-task-empty-list">
            <i class="fas fa-magnifying-glass"></i>
            <strong>${adminState.searchTerm ? "No results found" : "No tasks found"}</strong>
            <span>Adjust filters to see more tasks.</span>
        </div>
    `;
}

function renderAdminTaskDetail(projectMap) {
    const task = getSelectedAdminTask();
    if (!task) return "";
    const project = projectMap.get(String(task.project_id));
    return adminTaskEditMode ? renderAdminTaskEditPanel(task, project) : renderAdminTaskReadPanel(task, project);
}

function renderAdminTaskReadPanel(task, project) {
    const status = normalizeStatusLabel(task.status);
    const statusClass = statusClassName(task.status);
    const priority = normalizeTaskPriority(task.priority);
    const priorityClass = priority.toLowerCase().replace(/\s+/g, "-");
    const assignedBy = getAdminTaskAssignedBy(task, project);
    const assignedByName = getAdminUserDisplayName(assignedBy);

    return `
        <div class="admin-task-detail-content">
            <div class="admin-task-detail-header">
                <div class="admin-task-detail-title-group">
                    <span class="admin-task-detail-kicker">Task Details</span>
                    <h2>${escapeHtml(task.title || "Untitled Task")}</h2>
                    <p><i class="fas fa-folder"></i>${escapeHtml(project?.name || "Unknown Project")}</p>
                </div>
                
                <div class="admin-task-detail-actions">
                    <button class="admin-task-detail-back" type="button" onclick="closeAdminTaskDetail()" aria-label="Back to task list">
                        <i class="fas fa-arrow-left"></i>
                        <span>Back</span>
                    </button>
                    <button type="button" onclick="enterAdminTaskEditMode()"><i class="fas fa-pen"></i>Edit</button>
                    <button class="danger" type="button" onclick="adminDeleteTask('${escapeHtml(task.id)}')"><i class="fas fa-trash"></i>Delete</button>
                </div>
            </div>

            <section class="admin-task-detail-grid">
                <div><span>Project</span><strong>${escapeHtml(project?.name || "Unknown")}</strong></div>
                <div><span>Assigned by</span><strong title="${escapeHtml(assignedBy)}">${escapeHtml(assignedByName || assignedBy)}</strong></div>
                <div><span>Priority</span><strong><span class="task-priority-pill ${priorityClass}">${escapeHtml(priority)}</span></strong></div>
                <div><span>Status</span><strong>${renderAdminTaskStatusControl(task, statusClass)}</strong></div>
                <div><span>Due date</span><strong>${escapeHtml(formatDate(task.deadline || task.due_date))}</strong></div>
            </section>

            <section class="admin-task-detail-section">
                <h3>Description</h3>
                <p class="admin-task-detail-description">${escapeHtml(task.description || "No description added.")}</p>
            </section>

            <section class="admin-task-detail-section">
                <h3>Assigned Members</h3>
                ${renderAdminTaskDetailAssignees(task)}
            </section>

            <section class="admin-task-detail-section">
                <h3>Attachments</h3>
                ${renderAdminTaskAttachments(task) || `<p class="admin-task-muted">No attachments.</p>`}
            </section>

            ${renderAdminTaskTimeline(task)}
            ${renderAdminTaskComments(task)}
        </div>
    `;
}

function getAdminTaskAssignedBy(task, project) {
    return task.assigned_by || task.assigned_by_email || task.created_by || project?.owner_email || project?.assigned_manager || "Unknown";
}

function renderAdminTaskEditPanel(task, project) {
    const priority = normalizeTaskPriority(task.priority);
    const status = normalizeStatusLabel(task.status);
    return `
        <form class="admin-task-detail-content admin-task-edit-panel" onsubmit="saveAdminTaskEdit(event, '${escapeHtml(task.id)}')">
            <div class="admin-task-detail-header">
                <button class="admin-task-detail-back" type="button" onclick="exitAdminTaskEditMode()" aria-label="Cancel edit">
                    <i class="fas fa-arrow-left"></i>
                    <span>Back to Details</span>
                </button>
                <div>
                    <h2>Edit Task</h2>
                    <p>${escapeHtml(project?.name || "Unknown Project")}</p>
                </div>
            </div>
            <label>Title<input id="adminTaskEditTitle" value="${escapeHtml(task.title || "")}" required></label>
            <label>Description<textarea id="adminTaskEditDescription" rows="4">${escapeHtml(task.description || "")}</textarea></label>
            <div class="admin-task-edit-grid">
                <label>Priority
                    <select id="adminTaskEditPriority">
                        ${["Low", "Medium", "High", "Urgent"].map(item => `<option value="${item}" ${priority === item ? "selected" : ""}>${item}</option>`).join("")}
                    </select>
                </label>
                <label>Status
                    <select id="adminTaskEditStatus">
                        ${["Pending", "In Progress", "Completed", "On Hold", "Planning"].map(item => `<option value="${item}" ${status === item ? "selected" : ""}>${item}</option>`).join("")}
                    </select>
                </label>
                <label>Due date<input id="adminTaskEditDeadline" type="date" value="${escapeHtml(task.deadline || task.due_date || "")}"></label>
            </div>
            <div class="admin-task-edit-actions">
                <button class="secondary" type="button" onclick="exitAdminTaskEditMode()">Cancel</button>
                <button type="submit"><i class="fas fa-floppy-disk"></i>Save Changes</button>
            </div>
        </form>
    `;
}

function getSelectedAdminTask() {
    if (!selectedAdminTaskId) return null;
    return adminState.tasks.find((task) => String(task.id) === String(selectedAdminTaskId)) || null;
}

function openAdminTaskDetail(taskId) {
    const list = document.getElementById("adminTasksInboxList");
    if (list) {
        adminTaskInboxScrollTop = list.scrollTop;
        sessionStorage.setItem("taskflow.adminTaskInboxScrollTop", String(adminTaskInboxScrollTop));
    }
    selectedAdminTaskId = String(taskId || "");
    adminTaskDetailOpen = true;
    adminTaskEditMode = false;
    sessionStorage.setItem("taskflow.adminSelectedTaskId", selectedAdminTaskId);
    renderTasksView();
}

function closeAdminTaskDetail() {
    adminTaskDetailOpen = false;
    adminTaskEditMode = false;
    renderTasksView();
    restoreAdminTaskInboxScroll();
}

function restoreAdminTaskInboxScroll() {
    if (adminTaskDetailOpen) return;
    const list = document.getElementById("adminTasksInboxList");
    if (!list || !adminTaskInboxScrollTop) return;
    requestAnimationFrame(() => {
        list.scrollTop = adminTaskInboxScrollTop;
    });
}

function handleAdminTaskCardKeydown(event, taskId) {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openAdminTaskDetail(taskId);
        return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(document.querySelectorAll(".admin-task-card[data-task-id]"));
    const index = items.findIndex((item) => String(item.dataset.taskId) === String(taskId));
    const nextIndex = event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
    items[nextIndex]?.focus();
}

function setAdminTaskPriorityFilter(value) {
    adminTaskFilters.priority = value || "all";
    adminTaskFilters.page = 1;
    renderTasksView();
}

function setAdminTaskDueFilter(value) {
    adminTaskFilters.due = value || "all";
    adminTaskFilters.page = 1;
    renderTasksView();
}

function setAdminTaskSort(value) {
    adminTaskFilters.sort = value || "newest";
    adminTaskFilters.page = 1;
    renderTasksView();
}

function adminTaskMatchesDueFilter(task, filter) {
    if (filter === "all") return true;
    const due = task.deadline || task.due_date;
    if (filter === "none") return !due;
    if (!due) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(String(due).length === 10 ? `${due}T00:00:00` : due);
    dueDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((dueDate - today) / 86400000);

    if (filter === "overdue") return diffDays < 0;
    if (filter === "today") return diffDays === 0;
    if (filter === "week") return diffDays >= 0 && diffDays <= 7;
    return true;
}

function compareAdminTasks(a, b, sortValue) {
    if (sortValue === "title-asc") return String(a.title || "").localeCompare(String(b.title || ""));
    if (sortValue === "priority-desc") {
        const weight = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
        return (weight[normalizeTaskPriority(b.priority)] || 0) - (weight[normalizeTaskPriority(a.priority)] || 0);
    }
    if (sortValue === "due-asc") return getAdminTaskDueTime(a) - getAdminTaskDueTime(b);
    return new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0);
}

function getAdminTaskDueTime(task) {
    const due = task.deadline || task.due_date;
    if (!due) return Number.MAX_SAFE_INTEGER;
    const date = new Date(String(due).length === 10 ? `${due}T00:00:00` : due);
    return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function getAdminTaskPreview(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > 88 ? `${text.slice(0, 88)}...` : text;
}

function getAdminTaskAttachments(task) {
    return Array.isArray(task?.attachments) ? task.attachments.filter(Boolean) : [];
}

function renderAdminTaskAvatarStack(task) {
    const assignments = getTaskAssignments(task);
    if (!assignments.length) return `<span class="admin-task-avatar-empty">Unassigned</span>`;
    const visible = assignments.slice(0, 3);
    const extra = assignments.length - visible.length;
    return `
        ${visible.map((assignment) => {
            const email = String(assignment.user_id || "Unassigned");
            const name = getAdminUserDisplayName(email);
            return `<span class="admin-task-avatar-mini" title="${escapeHtml(email)}">${escapeHtml(getInitial(name || email))}</span>`;
        }).join("")}
        ${extra > 0 ? `<span class="admin-task-avatar-extra">+${extra}</span>` : ""}
    `;
}

function renderAdminTaskStatusControl(task, statusClass) {
    const status = normalizeStatusLabel(task.status);
    return `
       
        <span class="status-pill ${statusClass} admin-task-detail-status-label">${escapeHtml(status)}</span>
    `;
}

function renderAdminTaskDetailAssignees(task) {
    const assignments = getTaskAssignments(task);
    if (!assignments.length) return `<p class="admin-task-muted">Unassigned.</p>`;
    return `
        <div class="admin-task-detail-assignees">
            ${assignments.map((assignment) => {
                const email = String(assignment.user_id || "Unassigned");
                const name = getAdminUserDisplayName(email);
                const status = normalizeStatusLabel(assignment.status);
                return `
                    <div class="admin-task-detail-assignee">
                        <span class="admin-task-avatar-mini">${escapeHtml(getInitial(name || email))}</span>
                        <div>
                            <strong>${escapeHtml(name)}</strong>
                            <small>${escapeHtml(email)}</small>
                        </div>
                        <span class="admin-member-status ${statusClassName(status)}">${escapeHtml(status)}</span>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function renderAdminTaskAttachments(task) {
    const attachments = getAdminTaskAttachments(task);
    if (!attachments.length) return "";
    return `
        <div class="admin-task-attachment-list">
            ${attachments.map((attachment, index) => {
                const name = typeof attachment === "string" ? attachment : (attachment?.name || attachment?.stored_name || `Attachment ${index + 1}`);
                const storedName = typeof attachment === "string" ? attachment : (attachment?.stored_name || attachment?.name || "");
                if (!storedName) return "";
                return `
                    <a class="admin-task-attachment-link"
                    href="javascript:void(0)"
                    onclick="downloadAdminTaskAttachment('${escapeHtml(task.id)}', '${escapeHtml(encodeURIComponent(storedName))}', '${escapeHtml(encodeURIComponent(name))}')">
                        <i class="fas fa-paperclip"></i>
                        <span>${escapeHtml(name)}</span>
                    </a>
                `;
            }).join("")}
        </div>
    `;
}

function renderAdminTaskTimeline(task) {
    const items = [
        task.created_at ? { label: "Task created", time: task.created_at } : null,
        task.updated_at ? { label: "Last updated", time: task.updated_at } : null,
        normalizeStatusLabel(task.status) === "Completed" ? { label: "Marked complete", time: task.updated_at || task.deadline } : null
    ].filter(Boolean);
    return `
        <section class="admin-task-detail-section">
            <h3>Activity Timeline</h3>
            <div class="admin-task-timeline">
                ${items.length ? items.map((item) => `
                    <div class="admin-task-timeline-item">
                        <span></span>
                        <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(formatDateTime(item.time))}</small></div>
                    </div>
                `).join("") : `<p class="admin-task-muted">No activity timeline yet.</p>`}
            </div>
        </section>
    `;
}

function renderAdminTaskComments(task) {
    const comments = Array.isArray(task.comments) ? task.comments : [];
    return `
        <section class="admin-task-detail-section">
            <h3>Comments</h3>
            <div class="admin-task-comments">
                ${comments.length ? comments.map((comment) => `
                    <article class="admin-task-comment">
                        <span class="admin-task-avatar-mini">${escapeHtml(getInitial(comment.author_name || comment.author))}</span>
                        <div>
                            <strong>${escapeHtml(comment.author_name || comment.author || "User")}</strong>
                            <p>${escapeHtml(comment.content || "")}</p>
                            <small>${escapeHtml(formatDateTime(comment.created_at))}</small>
                        </div>
                    </article>
                `).join("") : `<p class="admin-task-muted">No comments yet.</p>`}
            </div>
            <div class="admin-task-comment-form">
                <input id="admin-task-comment-input" type="text" placeholder="Add a comment..." onkeydown="if(event.key === 'Enter') addAdminTaskComment()">
                <button type="button" onclick="addAdminTaskComment()"><i class="fas fa-paper-plane"></i>Add Comment</button>
            </div>
        </section>
    `;
}


function enterAdminTaskEditMode() {
    adminTaskEditMode = true;
    renderTasksView();
}

function exitAdminTaskEditMode() {
    adminTaskEditMode = false;
    renderTasksView();
}

async function saveAdminTaskEdit(event, taskId) {
    event.preventDefault();
    const payload = {
        title: document.getElementById("adminTaskEditTitle")?.value.trim(),
        description: document.getElementById("adminTaskEditDescription")?.value.trim(),
        priority: document.getElementById("adminTaskEditPriority")?.value,
        status: document.getElementById("adminTaskEditStatus")?.value,
        deadline: document.getElementById("adminTaskEditDeadline")?.value
    };

    if (!payload.title) {
        showNotification("Task title is required.", "warning");
        return;
    }

    await adminUpdateTask(taskId, payload);
    adminTaskEditMode = false;
    await refreshAdminData();
    renderTasksView();
}

async function adminMarkTaskComplete(taskId) {
    await adminUpdateTaskStatus(taskId, "Completed");
}

async function adminUpdateTaskStatus(taskId, status) {
    await adminUpdateTask(taskId, { status });
    await refreshAdminData();
    renderTasksView();
}

async function adminUpdateTask(taskId, payload, options = {}) {
    const token = sessionStorage.getItem("token");
    try {
        const response = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || data.detail || "Unable to update task.");
        }
        if (!options.silent) {
            showNotification(data.message || "Task updated successfully.");
        }
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(`Task Updated: ${taskId}`);
        }
        return data.task || null;
    } catch (error) {
        console.error("Failed to update task", error);
        showNotification(error.message || "Unable to update task.", "error");
        return null;
    }
}

async function addAdminTaskComment() {
    const taskId = selectedAdminTaskId;
    const input = document.getElementById("admin-task-comment-input");
    const content = input?.value.trim();
    const token = sessionStorage.getItem("token");
    if (!taskId || !input) return;
    if (!content) {
        showNotification("Write a comment first.", "warning");
        return;
    }

    try {
        const response = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}/comments`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({ content })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || data.detail || "Unable to post comment.");
        }
        input.value = "";
        if (data.task) {
            adminState.tasks = adminState.tasks.map((task) => String(task.id) === String(taskId) ? data.task : task);
        } else {
            await refreshAdminData();
        }
        renderTasksView();
    } catch (error) {
        console.error("Failed to add admin task comment", error);
        showNotification(error.message || "Unable to post comment.", "error");
    }
}

async function downloadAdminTaskAttachment(taskId, encodedStoredName, encodedFileName) {
    const token = sessionStorage.getItem("token");
    if (!token || !taskId || !encodedStoredName) return;

    try {
        const storedName = decodeURIComponent(encodedStoredName);
        const fileName = encodedFileName ? decodeURIComponent(encodedFileName) : storedName;
        const response = await fetch(`${BASE_URL}/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(storedName)}`, {
            headers: { "Authorization": "Bearer " + token }
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || data.detail || "Unable to download attachment.");
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Failed to download task attachment", error);
        showNotification(error.message || "Unable to download attachment.", "error");
    }
}

function renderAdminTaskModal(projects) {
    const assignableUsers = adminState.users.filter((user) => String(user.role || "").toLowerCase() === "user");

    return `
        <div class="admin-modal-backdrop" onclick="handleAdminTaskBackdrop(event)">
            <div class="admin-modal-card admin-task-modal-card" role="dialog" aria-modal="true" aria-labelledby="admin-task-title" onclick="event.stopPropagation()">
                <div class="admin-modal-head">
                    <div>
                        <h3 id="admin-task-title">Assign Task</h3>
                        <p>Create a task and assign it to one or more users.</p>
                    </div>
                    <button class="admin-modal-close" type="button" aria-label="Close assign task modal" onclick="closeAdminTaskModal()">
                        <i class="fas fa-xmark"></i>
                    </button>
                </div>

                <form class="admin-user-form" onsubmit="submitAdminTask(event)">
                    <div class="admin-user-form-section">
                        <label class="admin-form-field">
                            <span>Project <strong>*</strong></span>
                            <select onchange="updateAdminTaskField('projectId', this.value)" required>
                                <option value="">Select project</option>
                                ${projects.map((project) => `
                                    <option value="${escapeHtml(String(project.id))}" ${String(adminState.newTaskForm.projectId) === String(project.id) ? "selected" : ""}>
                                        ${escapeHtml(project.name || "Untitled Project")}
                                    </option>
                                `).join("")}
                            </select>
                        </label>

                        <label class="admin-form-field">
                            <span>Task title <strong>*</strong></span>
                            <input type="text" value="${escapeHtml(adminState.newTaskForm.title)}" oninput="updateAdminTaskField('title', this.value)" placeholder="Enter task title" maxlength="160" required>
                        </label>
                        <label class="admin-form-field">
                            <span>Description</span>
                            <input type="text" value="${escapeHtml(adminState.newTaskForm.description)}" oninput="updateAdminTaskField('description', this.value)" placeholder="Task scope, notes, or delivery details" maxlength="220">
                        </label>

                        <label class="admin-form-field">
                            <span>Deadline</span>
                            <input type="date" value="${escapeHtml(adminState.newTaskForm.deadline)}" onchange="updateAdminTaskField('deadline', this.value)">
                        </label>
                        <label class="admin-form-field">
                            <span>Priority</span>
                            <select onchange="updateAdminTaskField('priority', this.value)">
                                ${["Low", "Medium", "High", "Urgent"].map((priority) => `
                                    <option value="${priority}" ${adminState.newTaskForm.priority === priority ? "selected" : ""}>${priority}</option>
                                `).join("")}
                            </select>
                        </label>

                        <div class="admin-form-field">
                            <span>Assign users <strong>*</strong></span>
                            <div class="admin-task-user-list">
                                ${assignableUsers.length ? assignableUsers.map((user) => {
                                    const checked = adminState.newTaskForm.assignedTo.includes(user.email);
                                    return `
                                        <label class="admin-task-user-option" data-user-search="${escapeHtml(`${String(user.username || "").toLowerCase()} ${String(user.email || "").toLowerCase()}`)}">
                                            <input type="checkbox" value="${escapeHtml(user.email)}" ${checked ? "checked" : ""} onchange="toggleAdminTaskAssignee(this.value, this.checked)">
                                            <span>${escapeHtml(user.username || user.email)}</span>
                                            <small>${escapeHtml(user.email)}</small>
                                        </label>
                                    `;
                                }).join("") : `<div class="project-empty-state admin-task-user-empty">No users available to assign.</div>`}
                            </div>
                        </div>
                        <label class="admin-form-field">
                            <span>Attachments</span>
                            <input type="file" multiple onchange="updateAdminTaskAttachments(this.files)">
                        </label>
                    </div>
                    <div class="admin-modal-actions">
                        <button class="action-btn secondary-btn" type="button" onclick="closeAdminTaskModal()">Cancel</button>
                        <button class="action-btn admin-add-user-btn" type="submit" ${adminState.isCreatingTask ? "disabled" : ""}>
                            <i class="fas fa-plus"></i>
                            ${adminState.isCreatingTask ? "Assigning..." : "Assign Task"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderTeamView() {
    const projectMap = new Map(adminState.projects.map((project) => [String(project.id), project]));
    const userMap = new Map(
        adminState.users.map((user) => [String(user.email || "").trim().toLowerCase(), user])
    );
    const searchValue = String(adminState.searchTerm || "").trim().toLowerCase();

    const visibleProjects = adminState.projects.filter((project) => {
        if (adminTeamFilters.projectId !== "all" && String(project.id) !== String(adminTeamFilters.projectId)) {
            return false;
        }

        if (!searchValue) return true;

        const projectTasks = adminState.tasks.filter((task) => String(task.project_id) === String(project.id));
        const members = buildAdminTeamRows(projectTasks, userMap);
        const haystack = [
            project.name,
            ...projectTasks.map((task) => task.title),
            ...members.flatMap((member) => [member.name, member.email])
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return haystack.includes(searchValue);
    });

    const projectOptions = adminState.projects.map((project) => `
        <option value="${escapeHtml(String(project.id))}" ${String(adminTeamFilters.projectId) === String(project.id) ? "selected" : ""}>
            ${escapeHtml(project.name || "Untitled Project")}
        </option>
    `).join("");

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view admin-team-view">
            ${renderCommonPageLayout({
                pageClass: "admin-module-page admin-team-page",
                header: renderCommonPageHeader(
                    "Team",
                    "Review team members by project with the same structured layout used across admin modules.",
                    "",
                    `
                        <div class="common-toolbar">
                            <select class="admin-team-filter common-filter-select" onchange="setAdminTeamProjectFilter(this.value)" aria-label="Filter team projects">
                                <option value="all">All Projects</option>
                                ${projectOptions}
                            </select>
                        </div>
                    `
                ),
                content: renderCommonContentCard(`
                    <div class="admin-team-project-list">
                        ${visibleProjects.length ? visibleProjects.map((project, index) => renderAdminTeamProject(project, projectMap, userMap, index)).join("") : `<div class="empty-state">${adminState.searchTerm ? "No results found" : "No team members found."}</div>`}
                    </div>
                `)
            })}
        </div>
    `;
}

function renderAdminTeamProject(project, projectMap, userMap, index) {
    const projectTasks = adminState.tasks.filter((task) => String(task.project_id) === String(project.id));
    const members = buildAdminTeamRows(projectTasks, userMap);
    const isExpanded = isAdminTeamProjectExpanded(project.id, index === 0 || adminTeamFilters.projectId !== "all" || Boolean(adminState.searchTerm));

    return `
        <section class="admin-team-project-card ${isExpanded ? "expanded" : "collapsed"}">
            <button class="admin-team-project-head" type="button" onclick="toggleAdminTeamProject('${escapeHtml(String(project.id))}')" aria-expanded="${isExpanded ? "true" : "false"}">
                <div class="admin-team-project-title">
                    <span class="admin-team-project-icon">
                        <i class="fas fa-folder"></i>
                    </span>
                    <h4>${escapeHtml(project.name || "Untitled Project")}</h4>
                    <span class="admin-team-member-count">${members.length} Member${members.length === 1 ? "" : "s"}</span>
                </div>
                <span class="admin-team-project-toggle" aria-hidden="true">
                    <i class="fas fa-chevron-down"></i>
                </span>
            </button>
            <div class="admin-team-table-wrap common-table-wrapper ${isExpanded ? "" : "hidden"}">
                <table class="admin-table admin-team-table">
                    <thead>
                        <tr>
                            <th>Member</th>
                            <th>Email</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${members.length ? members.map((member) => renderAdminTeamMemberRow(member)).join("") : `<tr><td colspan="2" class="empty-state">No members yet.</td></tr>`}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function buildAdminTeamRows(tasks, userMap) {
    const members = new Map();

    tasks.forEach((task) => {
        getTaskAssignments(task).forEach((assignment) => {
            const email = String(assignment.user_id || "").trim().toLowerCase();
            if (!email || members.has(email)) return;

            const user = userMap.get(email) || {};
            members.set(email, {
                email: assignment.user_id || email,
                name: user.username || assignment.user_id || email
            });
        });
    });

    return Array.from(members.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function renderAdminTeamMemberRow(member) {
    return `
        <tr>
            <td>
                <span class="admin-team-member-cell">
                    <span class="admin-team-avatar">${escapeHtml(getInitial(member.name || member.email))}</span>
                    <span>${escapeHtml(member.name || "Unknown")}</span>
                </span>
            </td>
            <td>${escapeHtml(member.email || "-")}</td>
        </tr>
    `;
}

function isAdminTeamProjectExpanded(projectId, defaultExpanded = false) {
    const key = String(projectId || "");
    if (Object.prototype.hasOwnProperty.call(expandedAdminTeamProjects, key)) {
        return expandedAdminTeamProjects[key];
    }
    return defaultExpanded;
}

function toggleAdminTeamProject(projectId) {
    const key = String(projectId || "");
    expandedAdminTeamProjects[key] = !isAdminTeamProjectExpanded(key, true);
    renderTeamView();
}

function setAdminTeamProjectFilter(value) {
    adminTeamFilters.projectId = value || "all";
    renderTeamView();
}

function setAdminTaskProjectFilter(value) {
    adminTaskFilters.projectId = value || "all";
    adminTaskFilters.page = 1;
    renderTasksView();
}

function setAdminTaskStatusFilter(value) {
    adminTaskFilters.status = value || "all";
    adminTaskFilters.page = 1;
    renderTasksView();
}

function setAdminTaskPage(page) {
    adminTaskFilters.page = page;
    renderTasksView();
}

function openAdminTaskModal(projectId = "") {
    adminState.isTaskModalOpen = true;
    adminState.newTaskForm = {
        projectId: projectId || (adminTaskFilters.projectId !== "all" ? String(adminTaskFilters.projectId) : ""),
        title: "",
        description: "",
        priority: "Medium",
        assignedTo: [],
        deadline: "",
        attachments: []
    };
    renderTasksView();
}

function closeAdminTaskModal() {
    adminState.isTaskModalOpen = false;
    adminState.isCreatingTask = false;
    adminState.newTaskForm = {
        projectId: "",
        title: "",
        description: "",
        priority: "Medium",
        assignedTo: [],
        deadline: "",
        attachments: []
    };
    renderTasksView();
}

function handleAdminTaskBackdrop(event) {
    if (event.target.classList.contains("admin-modal-backdrop")) {
        closeAdminTaskModal();
    }
}

function updateAdminTaskField(field, value) {
    if (!(field in adminState.newTaskForm)) return;
    adminState.newTaskForm[field] = value;
}

function updateAdminTaskAttachments(fileList) {
    adminState.newTaskForm.attachments = Array.from(fileList || []);
    renderTasksView();
}

function toggleAdminTaskAssignee(email, checked) {
    const selected = new Set(adminState.newTaskForm.assignedTo);
    if (checked) {
        selected.add(email);
    } else {
        selected.delete(email);
    }
    adminState.newTaskForm.assignedTo = Array.from(selected);
}

function filterAdminTaskAssignees(value) {
    const query = String(value || "").trim().toLowerCase();
    document.querySelectorAll(".admin-task-user-option").forEach((option) => {
        const haystack = String(option.dataset.userSearch || "");
        option.style.display = !query || haystack.includes(query) ? "" : "none";
    });
}

async function submitAdminTask(event) {
    if (event) event.preventDefault();
    if (adminState.isCreatingTask) return;

    const token = sessionStorage.getItem("token");
    const projectId = String(adminState.newTaskForm.projectId || "").trim();
    const title = String(adminState.newTaskForm.title || "").trim();
    const description = String(adminState.newTaskForm.description || "").trim();
    const priority = String(adminState.newTaskForm.priority || "Medium").trim();
    const assignedTo = adminState.newTaskForm.assignedTo.filter(Boolean);
    const deadline = String(adminState.newTaskForm.deadline || "").trim();
    const attachments = Array.isArray(adminState.newTaskForm.attachments) ? adminState.newTaskForm.attachments : [];

    if (!projectId) {
        showNotification("Please select a project.", "warning");
        return;
    }
    if (!title) {
        showNotification("Task title is required.", "warning");
        return;
    }
    if (!assignedTo.length) {
        showNotification("Select at least one user to assign.", "warning");
        return;
    }

    adminState.isCreatingTask = true;
    renderTasksView();

    try {
        const response = await fetch(`${BASE_URL}/tasks`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                title,
                task_title: title,
                project_id: projectId,
                description,
                priority,
                assigned_to: assignedTo,
                assigned_users: assignedTo,
                status: "Pending",
                deadline,
                due_date: deadline
            })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || data.detail || "Unable to assign task.");
        }

        if (attachments.length && data?.task?.id) {
            for (const file of attachments) {
                const formData = new FormData();
                formData.append("file", file);
                await fetch(`${BASE_URL}/tasks/${encodeURIComponent(data.task.id)}/attachments`, {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + token
                    },
                    body: formData
                });
            }
        }

        showNotification(data.message || `Task "${title}" assigned successfully.`);
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(`New Task Added: ${title}`);
        }
        await refreshAdminData();
        adminTaskFilters.projectId = projectId;
        closeAdminTaskModal();
    } catch (error) {
        console.error("Failed to assign task", error);
        adminState.isCreatingTask = false;
        renderTasksView();
        showNotification(error.message || "Unable to assign task.", "error");
    }
}

async function adminDeleteTask(id) {
    await deleteTask(id);
    if (String(selectedAdminTaskId) === String(id)) {
        selectedAdminTaskId = null;
        adminTaskDetailOpen = false;
        adminTaskEditMode = false;
        sessionStorage.removeItem("taskflow.adminSelectedTaskId");
    }
    await refreshAdminData();
    renderTasksView();
}

async function adminDeleteProject(id) {
    const token = sessionStorage.getItem("token");
    if (!id) return;

    if (!confirm("Delete this project?")) {
        return;
    }

    try {
        const response = await fetch(`${BASE_URL}/projects/${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || data.detail || "Unable to delete project.");
        }

        showNotification(data.message || "Project deleted successfully.");
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send("Project Deleted");
        }
        await refreshAdminData();
        renderProjectsView();
    } catch (error) {
        console.error("Failed to delete project", error);
        showNotification(error.message || "Unable to delete project.", "error");
    }
}

function openAdminProjectWorkspace(projectId) {
    if (!projectId) return;
    adminTaskFilters.projectId = String(projectId);
    adminTaskFilters.page = 1;
    setActiveNav("tasks");
    renderTasksView();
}

function renderUsersView() {

    const users = filterCollection(
        adminState.users,
        (user) => [user.username, user.email, user.role]
    ).filter((user) => {

        const roleFilter =
            String(adminUserFilters.role || "all")
                .trim()
                .toLowerCase();

        if (
            roleFilter !== "all" &&
            String(user.role || "")
                .trim()
                .toLowerCase() !== roleFilter
        ) {
            return false;
        }

        return true;
    });

    const currentEmail =
        String(sessionStorage.getItem("email") || "")
            .trim()
            .toLowerCase();

    const totalPages =
        Math.max(
            Math.ceil(users.length / adminUserFilters.pageSize),
            1
        );

    adminUserFilters.page =
        Math.min(
            Math.max(adminUserFilters.page, 1),
            totalPages
        );

    const startIndex =
        (adminUserFilters.page - 1) *
        adminUserFilters.pageSize;

    const pageUsers =
        users.slice(
            startIndex,
            startIndex + adminUserFilters.pageSize
        );

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view admin-users-view">

            ${renderCommonPageLayout({

                pageClass: "admin-module-page admin-users-page",

                header: renderCommonPageHeader(
                    "Users",
                    "Manage users, roles, and access permissions from one consistent workspace.",
                    "",
                    `
                        <div class="common-toolbar">
                            <select
                                class="common-filter-select"
                                onchange="setAdminUserRoleFilter(this.value)">

                                <option value="all"
                                    ${adminUserFilters.role === "all" ? "selected" : ""}>
                                    All Roles
                                </option>

                                <option value="user"
                                    ${adminUserFilters.role === "user" ? "selected" : ""}>
                                    User
                                </option>

                                <option value="manager"
                                    ${adminUserFilters.role === "manager" ? "selected" : ""}>
                                    Manager
                                </option>

                                <option value="admin"
                                    ${adminUserFilters.role === "admin" ? "selected" : ""}>
                                    Admin
                                </option>
                            </select>

                            
                            <button class="action-btn common-action-btn admin-add-user-btn" onclick="openInviteModal()">
                                <i class="fas fa-envelope"></i>
                                Invite User
                            </button>
                            <button
                                class="action-btn common-action-btn admin-add-user-btn"
                                type="button"
                                onclick="openAddUserModal()">

                                <i class="fas fa-plus"></i>
                                Add User
                            </button>

                        </div>
                    `
                ),

                content: renderCommonContentCard(`

                    <div class="data-table-wrap common-table-wrapper">

                        <table class="admin-table admin-users-table">

                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>

                            <tbody>

                                ${pageUsers.length
                                    ? pageUsers.map((user) => `

                                        <tr>

                                            <td>
                                                <div class="admin-user-cell">

                                                    <span class="admin-team-avatar">
                                                        ${escapeHtml(
                                                            getInitial(
                                                                user.username
                                                            )
                                                        )}
                                                    </span>

                                                    <span>
                                                        ${escapeHtml(
                                                            user.username ||
                                                            "Unknown User"
                                                        )}
                                                    </span>

                                                </div>
                                            </td>

                                            <td>
                                                ${escapeHtml(
                                                    user.email || "-"
                                                )}
                                            </td>

                                            <td>
                                                <span class="status-chip">
                                                    ${escapeHtml(
                                                        capitalize(
                                                            user.role || "user"
                                                        )
                                                    )}
                                                </span>
                                            </td>

                                            <td>

                                                ${String(user.email || "")
                                                    .trim()
                                                    .toLowerCase()
                                                    === currentEmail

                                                    ? `
                                                        <span class="disabled-action">
                                                            Current User
                                                        </span>
                                                    `

                                                    : `
                                                        <div class="admin-user-actions">

                                                            <select
                                                                class="common-filter-select"
                                                                onchange="changeUserRole('${escapeHtml(user.email)}', this.value)">

                                                                <option value="user"
                                                                    ${String(user.role || "")
                                                                        .toLowerCase() === "user"
                                                                        ? "selected" : ""}>
                                                                    User
                                                                </option>

                                                                <option value="manager"
                                                                    ${String(user.role || "")
                                                                        .toLowerCase() === "manager"
                                                                        ? "selected" : ""}>
                                                                    Manager
                                                                </option>

                                                            </select>

                                                            <button
                                                                class="action-btn delete-btn"
                                                                type="button"
                                                                onclick="deleteUser('${escapeHtml(user.email)}')">

                                                                Delete
                                                            </button>

                                                        </div>
                                                    `
                                                }

                                            </td>

                                        </tr>

                                    `).join("")

                                    : `
                                        <tr>
                                            <td colspan="4" class="empty-state">
                                                ${adminState.searchTerm ? "No results found" : "No users found."}
                                            </td>
                                        </tr>
                                    `
                                }

                            </tbody>

                        </table>

                    </div>

                    <div class="admin-task-footer">

                        <span class="app-pagination-summary">

                            ${users.length
                                ? `Showing ${startIndex + 1}
                                   to ${startIndex + pageUsers.length}
                                   of ${users.length} users`
                                : "Showing 0 users"}

                        </span>

                        <div class="app-pagination-controls">

                            <button
                                class="app-page-btn"
                                onclick="setAdminUserPage(${adminUserFilters.page - 1})"
                                ${adminUserFilters.page <= 1 ? "disabled" : ""}>

                                <i class="fas fa-chevron-left"></i>
                            </button>

                            <span class="app-page-current">
                                ${adminUserFilters.page}
                            </span>

                            <button
                                class="app-page-btn"
                                onclick="setAdminUserPage(${adminUserFilters.page + 1})"
                                ${adminUserFilters.page >= totalPages ? "disabled" : ""}>

                                <i class="fas fa-chevron-right"></i>
                            </button>

                        </div>

                    </div>

                `, "common-table-card")

            })}

            ${adminState.isUserModalOpen
                ? renderAddUserModal()
                : ""}

            ${adminState.isInviteModalOpen
                ? renderInviteUserModal()
                : ""}

        </div>
    `;
}

function openInviteModal() {
    adminState.isInviteModalOpen = true;
    adminState.isSendingInvitation = false;
    adminState.inviteUserForm = {
        email: "",
        role: "User"
    };
    renderUsersView();
}

function closeInviteModal() {
    adminState.isInviteModalOpen = false;
    adminState.isSendingInvitation = false;
    adminState.inviteUserForm = {
        email: "",
        role: "User"
    };
    renderUsersView();
}

function handleInviteBackdrop(event) {
    if (event.target.classList.contains("admin-modal-backdrop")) {
        closeInviteModal();
    }
}

function updateInviteField(field, value) {
    adminState.inviteUserForm = {
        ...adminState.inviteUserForm,
        [field]: value
    };
}

function renderInviteUserModal() {
    const form = adminState.inviteUserForm;

    return `
        <div class="admin-modal-backdrop invite-user-backdrop" onclick="handleInviteBackdrop(event)">
            <div class="admin-modal-card invite-user-card" role="dialog" aria-modal="true" aria-labelledby="admin-invite-user-title" onclick="event.stopPropagation()">
                <div class="admin-modal-head">
                    <div>
                        <h3 id="admin-invite-user-title">Invite User</h3>
                        <p>Invite an existing TaskFlow account into this workspace.</p>
                    </div>
                    <button class="admin-modal-close" type="button" aria-label="Close invite modal" onclick="closeInviteModal()">
                        <i class="fas fa-xmark"></i>
                    </button>
                </div>
                <form class="admin-user-form invite-user-form" onsubmit="sendInvitation(event)">
                    <div class="admin-user-form-section">
                        <h4>Invitation Details</h4>
                        <label class="admin-form-field">
                            <span>User Email <strong>*</strong></span>
                            <input type="email" id="inviteEmail" placeholder="user@example.com" value="${escapeHtml(form.email)}" oninput="updateInviteField('email', this.value)" required>
                        </label>
                        <label class="admin-form-field">
                            <span>Role <strong>*</strong></span>
                            <select id="inviteRole" onchange="updateInviteField('role', this.value)" required>
                                <option value="User" ${form.role === "User" ? "selected" : ""}>User</option>
                                <option value="Manager" ${form.role === "Manager" ? "selected" : ""}>Manager</option>
                            </select>
                        </label>
                    </div>
                    <div class="admin-modal-actions">
                        <button class="action-btn secondary-btn" type="button" onclick="closeInviteModal()">Cancel</button>
                        <button class="action-btn export-btn" id="sendInviteButton" type="submit" ${adminState.isSendingInvitation ? "disabled" : ""}>
                            <i class="fas ${adminState.isSendingInvitation ? "fa-spinner fa-spin" : "fa-paper-plane"}"></i>
                            <span>${adminState.isSendingInvitation ? "Sending..." : "Send Invitation"}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

async function sendInvitation(event) {
    if (event) event.preventDefault();

    const email = String(adminState.inviteUserForm.email || "").trim().toLowerCase();
    const role = String(adminState.inviteUserForm.role || "User").trim();

    const token = sessionStorage.getItem("token");
    const requestUrl = `${BASE_URL}/api/invitations/send`;
    const payload = {
        email,
        role
    };

    if (!token) {
        showNotification("Session expired. Please login again.", "error");
        return;
    }

    if (!email) {
        showNotification("Enter the user's registered email.", "warning");
        return;
    }

    adminState.isSendingInvitation = true;
    renderUsersView();

    try {
        const response = await fetch(requestUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || data.success === false) {
            throw new Error(data.message || data.detail || "Failed to send invitation");
        }

        showNotification(data.message || "Invitation sent successfully.", "success");
        await loadAdminNotifications();
        closeInviteModal();

    } catch (error) {
        adminState.isSendingInvitation = false;
        renderUsersView();
        showNotification(error.message || "Unable to send invitation.", "error");
        console.error(error);
    }
}

function setAdminUserPage(page) {
    adminUserFilters.page = page;
    renderUsersView();
}

function setAdminUserRoleFilter(value) {
    adminUserFilters.role = value || "all";
    adminUserFilters.page = 1;
    renderUsersView();
}

function resetAdminUserFilters() {
    adminUserFilters.role = "all";
    adminUserFilters.page = 1;
    renderUsersView();
}

function renderAddUserModal() {
    const form = adminState.newUserForm;

    return `
        <div class="admin-modal-backdrop" onclick="handleAddUserBackdrop(event)">
            <div class="admin-modal-card" role="dialog" aria-modal="true" aria-labelledby="admin-add-user-title" onclick="event.stopPropagation()">
                <div class="admin-modal-head">
                    <div>
                        <h3 id="admin-add-user-title">Add User</h3>
                        <p>Create a new account and assign the right access level.</p>
                    </div>
                    <button class="admin-modal-close" type="button" aria-label="Close add user modal" onclick="closeAddUserModal()">
                        <i class="fas fa-xmark"></i>
                    </button>
                </div>
                <form class="admin-user-form" onsubmit="submitAddUser(event)">
                    <div class="admin-user-form-section">
                        <h4>User Information</h4>
                        <label class="admin-form-field">
                            <span>Name <strong>*</strong></span>
                            <input type="text" id="admin-new-user-name" placeholder="Enter full name" value="${escapeHtml(form.username)}" oninput="updateAddUserField('username', this.value)" required>
                        </label>
                        <label class="admin-form-field">
                            <span>Email <strong>*</strong></span>
                            <input type="email" id="admin-new-user-email" placeholder="Enter email address" value="${escapeHtml(form.email)}" oninput="updateAddUserField('email', this.value)" required>
                        </label>
                        <label class="admin-form-field">
                            <span>Role <strong>*</strong></span>
                            <select id="admin-new-user-role" onchange="updateAddUserField('role', this.value)" required>
                                <option value="user" ${form.role === "user" ? "selected" : ""}>User</option>
                                <option value="manager" ${form.role === "manager" ? "selected" : ""}>Manager</option>
                                <option value="admin" ${form.role === "admin" ? "selected" : ""}>Admin</option>
                            </select>
                        </label>
                    </div>
                    <div class="admin-modal-actions">
                        <button class="action-btn secondary-btn" type="button" onclick="closeAddUserModal()">Cancel</button>
                        <button class="action-btn export-btn" type="submit" ${adminState.isCreatingUser ? "disabled" : ""}>
                            ${adminState.isCreatingUser ? "Saving..." : "Save User"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function openAddUserModal() {
    adminState.isUserModalOpen = true;
    renderUsersView();
}

function closeAddUserModal() {
    adminState.isUserModalOpen = false;
    adminState.isCreatingUser = false;
    adminState.newUserForm = {
        username: "",
        email: "",
        role: "user"
    };
    renderUsersView();
}

function handleAddUserBackdrop(event) {
    if (event.target.classList.contains("admin-modal-backdrop")) {
        closeAddUserModal();
    }
}

function updateAddUserField(field, value) {
    adminState.newUserForm = {
        ...adminState.newUserForm,
        [field]: value
    };
}

async function submitAddUser(event) {
    event.preventDefault();

    const token = sessionStorage.getItem("token");
    if (!token) {
        alert("Login required.");
        return;
    }

    const payload = {
        username: String(adminState.newUserForm.username || "").trim(),
        email: String(adminState.newUserForm.email || "").trim().toLowerCase(),
        role: String(adminState.newUserForm.role || "user").trim().toLowerCase()
    };

    if (!payload.username || !payload.email || !payload.role) {
        alert("Please fill in all required fields.");
        return;
    }

    adminState.isCreatingUser = true;
    renderUsersView();

    try {
        const res = await fetch(`${BASE_URL}/admin/users`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.detail || data.message || "Unable to create user");
        }

        await refreshAdminData();
        adminUserFilters.page = 1;
        closeAddUserModal();
        renderUsersView();
        showNotification("User created and temporary password sent by email.");
        alert("User created successfully.\nA temporary password was sent to the user's email.");
    } catch (error) {
        adminState.isCreatingUser = false;
        renderUsersView();
        alert(error.message || "Unable to create user");
    }
}

async function changeUserRole(email, newRole) {
    const token = sessionStorage.getItem("token");

    if (!token) {
        alert("Login required.");
        return;
    }

    try {
        const res = await fetch(`${BASE_URL}/users/role?email=${encodeURIComponent(email)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({ new_role: newRole })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.detail || data.message || "Unable to update role");
        }

        await refreshAdminData();
        renderUsersView();
        showNotification(`Updated ${email} to ${capitalize(newRole)}`);
    } catch (error) {
        alert(error.message || "Unable to update role");
        await refreshAdminData();
        renderUsersView();
    }
}

async function deleteUser(email) {
    const token = sessionStorage.getItem("token");

    if (!token) {
        alert("Login required.");
        return;
    }

    if (!confirm(`Delete user ${email}?`)) {
        return;
    }

    try {
        const res = await fetch(`${BASE_URL}/users/${encodeURIComponent(email)}`, {
            method: "DELETE",
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        const data = await res.json();
        alert(data.message || "User deletion completed.");

        await refreshAdminData();
        const nextTotalPages = Math.max(Math.ceil(adminState.users.length / adminUserFilters.pageSize), 1);
        adminUserFilters.page = Math.min(adminUserFilters.page, nextTotalPages);
        renderCurrentSection();
    } catch (error) {
        console.error("Failed to delete user", error);
        alert("Unable to delete user.");
    }
}

function renderReportsView() {
    const { filteredProjects, filteredTasks } = getAdminReportData();
    const completed = filteredTasks.filter((task) => isCompletedStatus(task.status)).length;
    const inProgress = filteredTasks.filter((task) => isInProgressStatus(task.status)).length;
    const overdue = filteredTasks.filter((task) => isOverdue(task.deadline) && !isCompletedStatus(task.status)).length;
    const pending = Math.max(filteredTasks.length - completed - inProgress - overdue, 0);
    const activeUsers = new Set(filteredTasks.flatMap(getTaskMembers)).size;
    const inactiveUsers = Math.max(adminState.users.length - activeUsers, 0);
    const topProjects = getAdminTopProjectItems(filteredProjects, filteredTasks);
    const activityItems = getAdminUserActivityItems(filteredTasks);

    adminReportState.filteredProjects = filteredProjects;
    adminReportState.filteredTasks = filteredTasks;

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view admin-report-dashboard">
            ${renderCommonPageLayout({
                pageClass: "admin-module-page admin-reports-page",
                header: renderCommonPageHeader(
                    "Reports",
                    "Filter task and project performance by deadline date.",
                    "",
                    `
                        <div class="common-toolbar admin-report-toolbar">
                            <label class="admin-date-field" for="admin-report-start-date">
                                <span>Start</span>
                                <input id="admin-report-start-date" type="date" value="${escapeHtml(adminReportState.startDate)}" onchange="setAdminReportDateRange()">
                            </label>
                            <label class="admin-date-field" for="admin-report-end-date">
                                <span>End</span>
                                <input id="admin-report-end-date" type="date" value="${escapeHtml(adminReportState.endDate)}" onchange="setAdminReportDateRange()">
                            </label>
                            <button class="action-btn common-action-btn secondary-btn" type="button" onclick="clearAdminReportDateRange()">
                                <i class="fas fa-rotate-left"></i>
                                Clear
                            </button>
                            <div class="admin-export-group">
                                <button class="action-btn common-action-btn export-btn" type="button" onclick="exportAdminReport('excel')">
                                    <i class="fas fa-file-excel"></i>
                                    Excel
                                </button>
                                <button class="action-btn common-action-btn export-btn" type="button" onclick="exportAdminReport('pdf')">
                                    <i class="fas fa-file-pdf"></i>
                                    PDF
                                </button>
                                <button class="action-btn common-action-btn export-btn" type="button" onclick="exportAdminReport('csv')">
                                    <i class="fas fa-file-csv"></i>
                                    CSV
                                </button>
                            </div>
                        </div>
                    `
                ),
                content: `
                    <section class="admin-report-kpis">
                        ${renderAdminReportKpi("Total Users", adminState.users.length, "fas fa-users", "blue", "All registered users")}
                        ${renderAdminReportKpi("Total Projects", filteredProjects.length, "far fa-folder", "green", getAdminReportRangeLabel())}
                        ${renderAdminReportKpi("Total Tasks", filteredTasks.length, "far fa-square-check", "purple", "Filtered tasks")}
                        ${renderAdminReportKpi("Tasks Completed", completed, "far fa-circle-check", "orange", `${filteredTasks.length ? Math.round((completed / filteredTasks.length) * 100) : 0}% of tasks`)}
                    </section>

                    <section class="admin-report-main-grid">
                        <article class="admin-report-panel task-overview-panel">
                            <div class="admin-report-panel-head">
                                <h3>Task Overview</h3>
                                <select class="admin-report-select" aria-label="Task overview range">
                                    <option>Daily</option>
                                    <option>Weekly</option>
                                    <option>Monthly</option>
                                </select>
                            </div>
                            <div class="admin-line-legend">
                                <span><i class="legend-line created"></i>Created</span>
                                <span><i class="legend-line completed"></i>Completed</span>
                                <span><i class="legend-line overdue"></i>Overdue</span>
                            </div>
                            <div class="admin-report-chart-wrap line">
                                <canvas id="adminReportProjectChart"></canvas>
                            </div>
                        </article>

                        <article class="admin-report-panel status-breakdown-panel">
                            <div class="admin-report-panel-head">
                                <h3>Tasks by Status</h3>
                            </div>
                            <div class="admin-status-layout">
                                <div class="admin-report-chart-wrap donut">
                                    <canvas id="adminReportStatusChart"></canvas>
                                    <div class="admin-donut-total">
                                        <strong>${filteredTasks.length}</strong>
                                        <span>Total</span>
                                    </div>
                                </div>
                                <div class="admin-status-list">
                                    ${renderAdminStatusItem("Completed", completed, filteredTasks.length, "completed")}
                                    ${renderAdminStatusItem("In Progress", inProgress, filteredTasks.length, "progress")}
                                    ${renderAdminStatusItem("Pending", pending, filteredTasks.length, "pending")}
                                    ${renderAdminStatusItem("Overdue", overdue, filteredTasks.length, "overdue")}
                                </div>
                            </div>
                        </article>
                    </section>

                    <section class="admin-report-bottom-grid">
                        <article class="admin-report-panel">
                            <div class="admin-report-panel-head">
                                <h3>Top Active Projects</h3>
                                ${renderAdminShowToggle("projects", topProjects.length)}
                            </div>
                            <div class="table-scroll">
                                <table class="admin-compact-table">
                                    <thead>
                                        <tr>
                                            <th>Project</th>
                                            <th>Owner</th>
                                            <th>Members</th>
                                            <th>Tasks</th>
                                            <th>Completed</th>
                                            <th>Progress</th>
                                        </tr>
                                    </thead>
                                    <tbody>${renderAdminTopProjectRows(topProjects)}</tbody>
                                </table>
                            </div>
                        </article>

                        <article class="admin-report-panel">
                            <div class="admin-report-panel-head">
                                <h3>User Activity Summary</h3>
                                ${renderAdminShowToggle("activity", activityItems.length)}
                            </div>
                            <div class="table-scroll">
                                <table class="admin-compact-table activity-table">
                                    <thead>
                                        <tr>
                                            <th>Activity</th>
                                            <th>Count</th>
                                            <th>Change</th>
                                        </tr>
                                    </thead>
                                    <tbody>${renderAdminUserActivityRows(activityItems)}</tbody>
                                </table>
                            </div>
                        </article>
                    </section>
                `
            })}
        </div>
    `;

    renderAdminReportCharts(filteredProjects, filteredTasks, { completed, inProgress, pending, overdue });
}

function getAdminReportData() {
    const startDate = adminReportState.startDate;
    const endDate = adminReportState.endDate;
    const visibleProjects = filterCollection(adminState.projects, (project) => [project.name, project.owner_email]);
    const visibleTasks = filterCollection(adminState.tasks, (task) => [task.title, getTaskMemberStatusSearchText(task), task.status, task.deadline]);
    const filteredTasks = filterAdminTasksByDate(visibleTasks, startDate, endDate);
    const hasDateFilter = Boolean(startDate || endDate);
    const taskProjectIds = new Set(filteredTasks.map((task) => String(task.project_id)));
    const filteredProjects = hasDateFilter
        ? visibleProjects.filter((project) => taskProjectIds.has(String(project.id)))
        : visibleProjects;

    return { filteredProjects, filteredTasks };
}

function setAdminReportDateRange() {
    const startInput = document.getElementById("admin-report-start-date");
    const endInput = document.getElementById("admin-report-end-date");
    let startDate = startInput?.value || "";
    let endDate = endInput?.value || "";

    if (startDate && endDate && startDate > endDate) {
        endDate = startDate;
        if (endInput) endInput.value = startDate;
    }

    adminReportState.startDate = startDate;
    adminReportState.endDate = endDate;
    renderReportsView();
}

function clearAdminReportDateRange() {
    adminReportState.startDate = "";
    adminReportState.endDate = "";
    renderReportsView();
}

function parseAdminReportDate(value, endOfDay = false) {
    if (!value) return null;
    const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getAdminTaskReportDate(task) {
    const value = task.deadline || task.created_at || task.updated_at || "";
    if (!value) return null;
    const date = String(value).length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function filterAdminTasksByDate(tasks, startDate, endDate) {
    const start = parseAdminReportDate(startDate);
    const end = parseAdminReportDate(endDate, true);

    if (!start && !end) return tasks;

    return tasks.filter((task) => {
        const taskDate = getAdminTaskReportDate(task);
        if (!taskDate) return false;
        if (start && taskDate < start) return false;
        if (end && taskDate > end) return false;
        return true;
    });
}

function getAdminReportRangeLabel() {
    const start = adminReportState.startDate ? formatDate(adminReportState.startDate) : "All";
    const end = adminReportState.endDate ? formatDate(adminReportState.endDate) : "All";
    return adminReportState.startDate || adminReportState.endDate ? `${start} to ${end}` : "All dates";
}

function renderAdminReportMetric(label, value, icon, color, detail = "") {
    return `
        <article class="admin-report-card ${color}">
            <div class="admin-report-icon"><i class="${icon}"></i></div>
            <div>
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
            </div>
        </article>
    `;
}

function renderAdminReportKpi(label, value, icon, color, detail = "") {
    return `
        <article class="admin-kpi-card">
            <div class="admin-kpi-icon ${color}"><i class="${icon}"></i></div>
            <div class="admin-kpi-copy">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                <small><i class="fas fa-arrow-up"></i>${escapeHtml(detail)}</small>
            </div>
        </article>
    `;
}

function renderAdminStatusItem(label, count, total, type) {
    const percent = total ? ((count / total) * 100).toFixed(1) : "0.0";
    return `
        <div class="admin-status-row">
            <span><i class="status-dot ${type}"></i>${escapeHtml(label)}</span>
            <strong>${count} (${percent}%)</strong>
        </div>
    `;
}

function renderAdminShowToggle(section, total) {
    if (total <= 4) return "";

    const isExpanded = section === "projects"
        ? adminReportState.showAllProjects
        : adminReportState.showAllActivity;
    const label = isExpanded ? "Show Less" : "Show More";

    return `
        <button class="admin-show-toggle" type="button" onclick="toggleAdminReportList('${section}')">
            ${label}
        </button>
    `;
}

function toggleAdminReportList(section) {
    if (section === "projects") {
        adminReportState.showAllProjects = !adminReportState.showAllProjects;
    }

    if (section === "activity") {
        adminReportState.showAllActivity = !adminReportState.showAllActivity;
    }

    renderReportsView();
}

function renderAdminTopProjectRows(projectItems) {
    if (!projectItems.length) {
        return `<tr><td colspan="6" class="empty-state">No active projects found.</td></tr>`;
    }

    const visibleProjects = adminReportState.showAllProjects
        ? projectItems
        : projectItems.slice(0, 4);

    return visibleProjects.map((item) => `
        <tr>
            <td>${escapeHtml(item.project.name || "Untitled Project")}</td>
            <td>${escapeHtml(item.project.owner_email || "Unknown")}</td>
            <td>${item.members}</td>
            <td>${item.projectTasks.length}</td>
            <td>${item.completed}</td>
            <td>
                <div class="report-progress"><span style="width:${item.percent}%"></span></div>
                <strong class="progress-text">${item.percent}%</strong>
            </td>
        </tr>
    `).join("");
}

function getAdminTopProjectItems(projects, tasks) {
    return projects
        .map((project) => {
            const projectTasks = tasks.filter((task) => String(task.project_id) === String(project.id));
            const completed = projectTasks.filter((task) => isCompletedStatus(task.status)).length;
            const members = new Set(projectTasks.flatMap(getTaskMembers)).size;
            const percent = projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0;
            return { project, projectTasks, completed, members, percent };
        })
        .sort((a, b) => b.projectTasks.length - a.projectTasks.length || String(a.project.name || "").localeCompare(String(b.project.name || "")))
        .slice();
}

function getAdminUserActivityItems(tasks) {
    const taskMap = buildAdminTeamMap(tasks);

    return adminState.users
        .filter((user) => String(user.role || "").trim().toLowerCase() === "user")
        .map((user) => {
            const email = String(user.email || "").trim();
            const taskInfo = taskMap[email] || { total: 0, completed: 0 };
            const percent = taskInfo.total ? Math.round((taskInfo.completed / taskInfo.total) * 100) : 0;
            return {
                label: user.username || email || "Unknown User",
                email,
                total: taskInfo.total,
                completed: taskInfo.completed,
                percent
            };
        })
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

function renderAdminUserActivityRows(activityItems) {
    if (!activityItems.length) {
        return `<tr><td colspan="3" class="empty-state">No user activity found.</td></tr>`;
    }

    const visibleItems = adminReportState.showAllActivity
        ? activityItems
        : activityItems.slice(0, 4);

    return visibleItems.map((item) => {
        const isActive = item.total > 0;
        return `
            <tr>
                <td>
                    <span class="activity-user-name">${escapeHtml(item.label)}</span>
                    <small>${escapeHtml(item.email || "No email")}</small>
                </td>
                <td>${item.total}</td>
                <td><span class="activity-change ${isActive ? "up" : "down"}"><i class="fas fa-arrow-${isActive ? "up" : "down"}"></i>${item.percent}%</span></td>
            </tr>
        `;
    }).join("");
}

function renderAdminActivityRow(label, count, direction, change) {
    const isUp = direction === "up";
    return `
        <tr>
            <td>${escapeHtml(label)}</td>
            <td>${count}</td>
            <td><span class="activity-change ${isUp ? "up" : "down"}"><i class="fas fa-arrow-${isUp ? "up" : "down"}"></i>${escapeHtml(change)}</span></td>
        </tr>
    `;
}

function renderAdminProjectReportRows(projects, tasks) {
    if (!projects.length) {
        return `<tr><td colspan="6" class="empty-state">No project data found for this report.</td></tr>`;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return projects.map((project) => {
        const projectTasks = tasks.filter((task) => String(task.project_id) === String(project.id));
        const total = projectTasks.length;
        const completed = projectTasks.filter((task) => isCompletedStatus(task.status)).length;
        const progress = projectTasks.filter((task) => isInProgressStatus(task.status)).length;
        const overdue = projectTasks.filter((task) => task.deadline && new Date(`${task.deadline}T00:00:00`) < today && !isCompletedStatus(task.status)).length;
        const percent = total ? Math.round((completed / total) * 100) : 0;

        return `
            <tr>
                <td>${escapeHtml(project.name || "Untitled Project")}</td>
                <td>${total}</td>
                <td>${completed}</td>
                <td>${progress}</td>
                <td>${overdue}</td>
                <td>
                    <div class="report-progress"><span style="width:${percent}%"></span></div>
                    ${percent}%
                </td>
            </tr>
        `;
    }).join("");
}

function renderAdminTeamReportRows(tasks) {
    const teamMap = buildAdminTeamMap(tasks);
    const users = Object.keys(teamMap).sort();

    if (!users.length) {
        return `<tr><td colspan="4" class="empty-state">No team data found for this report.</td></tr>`;
    }

    return users.map((email) => {
        const item = teamMap[email];
        const percent = item.total ? Math.round((item.completed / item.total) * 100) : 0;
        return `
            <tr>
                <td>${escapeHtml(email)}</td>
                <td>${item.total}</td>
                <td>${item.completed}</td>
                <td>
                    <div class="report-progress"><span style="width:${percent}%"></span></div>
                    ${percent}%
                </td>
            </tr>
        `;
    }).join("");
}

function renderAdminTaskReportRows(tasks, projectMap) {
    if (!tasks.length) {
        return `<tr><td colspan="5" class="empty-state">No tasks found for this report.</td></tr>`;
    }

    return tasks.map((task) => renderTaskRow(task, projectMap)).join("");
}

function buildAdminTeamMap(tasks) {
    return tasks.reduce((map, task) => {
        getTaskAssignments(task).forEach((assignment) => {
            const email = assignment.user_id || "Unassigned";
            if (!map[email]) {
                map[email] = { total: 0, completed: 0 };
            }
            map[email].total += 1;
            if (isCompletedStatus(assignment.status)) {
                map[email].completed += 1;
            }
        });
        return map;
    }, {});
}

function renderAdminReportCharts(projects, tasks, counts) {
    const statusCanvas = document.getElementById("adminReportStatusChart");
    const projectCanvas = document.getElementById("adminReportProjectChart");
    const completedColor = getAdminStatusColorToken("completed");
    const progressColor = getAdminStatusColorToken("progress");
    const pendingColor = getAdminStatusColorToken("pending");
    const holdColor = getAdminStatusColorToken("hold");

    if (adminReportStatusChart) adminReportStatusChart.destroy();
    if (adminReportProjectChart) adminReportProjectChart.destroy();

    if (statusCanvas) {
        adminReportStatusChart = new Chart(statusCanvas, {
            type: "doughnut",
            data: {
                labels: ["Completed", "In Progress", "Pending", "Overdue"],
                datasets: [{
                    data: [counts.completed, counts.inProgress, counts.pending, counts.overdue],
                    backgroundColor: [completedColor, progressColor, pendingColor, holdColor],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "70%",
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${context.parsed}`
                        }
                    }
                }
            }
        });
    }

    if (projectCanvas) {
        const overview = buildAdminTaskOverview(tasks);

        adminReportProjectChart = new Chart(projectCanvas, {
            data: {
                labels: overview.labels,
                datasets: [
                    {
                        type: "line",
                        label: "Created",
                        data: overview.created,
                        borderColor: pendingColor,
                        backgroundColor: pendingColor,
                        pointRadius: 2,
                        tension: 0.35
                    },
                    {
                        type: "line",
                        label: "Completed",
                        data: overview.completed,
                        borderColor: completedColor,
                        backgroundColor: completedColor,
                        pointRadius: 2,
                        tension: 0.35
                    },
                    {
                        type: "line",
                        label: "Overdue",
                        data: overview.overdue,
                        borderColor: holdColor,
                        backgroundColor: holdColor,
                        pointRadius: 2,
                        tension: 0.35
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0, color: "#506078" },
                        grid: { color: "#edf1f6" }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: "#506078", maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }
}

function buildAdminTaskOverview(tasks) {
    const bucketMap = new Map();

    tasks.forEach((task) => {
        const taskDate = getAdminTaskReportDate(task);
        if (!taskDate) return;

        const key = [
            taskDate.getFullYear(),
            String(taskDate.getMonth() + 1).padStart(2, "0"),
            String(taskDate.getDate()).padStart(2, "0")
        ].join("-");

        if (!bucketMap.has(key)) {
            bucketMap.set(key, { created: 0, completed: 0, overdue: 0 });
        }

        const bucket = bucketMap.get(key);
        bucket.created += 1;
        if (isCompletedStatus(task.status)) bucket.completed += 1;
        if (isOverdue(task.deadline) && !isCompletedStatus(task.status)) bucket.overdue += 1;
    });

    const keys = Array.from(bucketMap.keys()).sort();
    const visibleKeys = keys.length ? keys.slice(-31) : [new Date().toISOString().slice(0, 10)];

    return {
        labels: visibleKeys.map(formatAdminChartDate),
        created: visibleKeys.map((key) => bucketMap.get(key)?.created || 0),
        completed: visibleKeys.map((key) => bucketMap.get(key)?.completed || 0),
        overdue: visibleKeys.map((key) => bucketMap.get(key)?.overdue || 0)
    };
}

function formatAdminChartDate(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
    });
}

function buildAdminReportRows() {
    const projects = adminReportState.filteredProjects;
    const tasks = adminReportState.filteredTasks;
    const completed = tasks.filter((task) => isCompletedStatus(task.status)).length;
    const inProgress = tasks.filter((task) => isInProgressStatus(task.status)).length;
    const overdue = tasks.filter((task) => isOverdue(task.deadline) && !isCompletedStatus(task.status)).length;
    const pending = Math.max(tasks.length - completed - inProgress - overdue, 0);
    const activeUsers = new Set(tasks.flatMap(getTaskMembers)).size;
    const inactiveUsers = Math.max(adminState.users.length - activeUsers, 0);
    const overview = buildAdminTaskOverview(tasks);
    const topProjects = getAdminTopProjectItems(projects, tasks);
    const rows = [
        ["TaskFlow Admin Report"],
        ["Date Range", adminReportState.startDate || "All", adminReportState.endDate || "All"],
        [],
        ["KPI Overview"],
        ["Metric", "Value"],
        ["Total Users", adminState.users.length],
        ["Total Projects", projects.length],
        ["Total Tasks", tasks.length],
        ["Completed Tasks", completed],
        [],
        ["Task Overview"],
        ["Date", "Created", "Completed", "Overdue"]
    ];

    overview.labels.forEach((label, index) => {
        rows.push([
            label,
            overview.created[index] || 0,
            overview.completed[index] || 0,
            overview.overdue[index] || 0
        ]);
    });

    rows.push(
        [],
        ["Tasks by Status"],
        ["Status", "Count", "Percentage"],
        ["Completed", completed, `${tasks.length ? ((completed / tasks.length) * 100).toFixed(1) : "0.0"}%`],
        ["In Progress", inProgress, `${tasks.length ? ((inProgress / tasks.length) * 100).toFixed(1) : "0.0"}%`],
        ["Pending", pending, `${tasks.length ? ((pending / tasks.length) * 100).toFixed(1) : "0.0"}%`],
        ["Overdue", overdue, `${tasks.length ? ((overdue / tasks.length) * 100).toFixed(1) : "0.0"}%`],
        [],
        ["Top Active Projects"],
        ["Project", "Owner", "Members", "Tasks", "Completed", "Progress"]
    );

    topProjects.forEach((item) => {
        rows.push([
            item.project.name || "Untitled Project",
            item.project.owner_email || "Unknown",
            item.members,
            item.projectTasks.length,
            item.completed,
            `${item.percent}%`
        ]);
    });

    rows.push(
        [],
        ["User Activity Summary"],
        ["Activity", "Count", "Change"],
        ["New Users", adminState.users.length, "20.0%"],
        ["Active Users", activeUsers, "15.6%"],
        ["Inactive Users", inactiveUsers, "-8.3%"],
        ["Users Over Limit", overdue, "-50.0%"]
    );

    return rows;
}

function exportAdminReport(format) {
    if (!adminState.users.length && !adminReportState.filteredProjects.length && !adminReportState.filteredTasks.length) {
        alert("No report data available to export.");
        return;
    }

    const rows = buildAdminReportRows();
    const rangeLabel = adminReportState.startDate || adminReportState.endDate
        ? `-${adminReportState.startDate || "start"}-to-${adminReportState.endDate || "end"}`
        : "";
    const filename = `taskflow-admin-report${rangeLabel}`;

    if (format === "excel" && window.XLSX) {
        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        worksheet["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Admin Report");
        XLSX.writeFile(workbook, `${filename}.xlsx`);
        return;
    }

    if (format === "pdf" && window.jspdf?.jsPDF) {
        exportAdminReportPdf(rows, filename);
        return;
    }

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    downloadAdminBlob(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
}

function exportAdminReportPdf(rows, filename) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    let currentY = 18;
    let headers = [];
    let body = [];

    doc.setFontSize(18);
    doc.text("TaskFlow Admin Report", 14, currentY);
    currentY += 10;
    doc.setFontSize(10);
    doc.text(`Date Range: ${adminReportState.startDate || "All"} to ${adminReportState.endDate || "All"}`, 14, currentY);
    currentY += 10;

    const flushTable = () => {
        if (!headers.length) return;
        doc.autoTable({
            startY: currentY,
            head: [headers],
            body,
            theme: "grid",
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [63, 126, 200] }
        });
        currentY = doc.lastAutoTable.finalY + 8;
        headers = [];
        body = [];
    };

    rows.slice(3).forEach((row) => {
        if (!row.length) return;
        if (row.length === 1) {
            flushTable();
            doc.setFontSize(12);
            doc.text(String(row[0]), 14, currentY);
            currentY += 6;
            return;
        }
        if (!headers.length) {
            headers = row;
        } else {
            body.push(row);
        }
    });

    flushTable();
    doc.save(`${filename}.pdf`);
}

function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadAdminBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function getAdminActivityLogExportRangeLabel() {
    const startDate = document.getElementById("activityLogStartDate")?.value || "";
    const endDate = document.getElementById("activityLogEndDate")?.value || "";

    if (!startDate && !endDate) return "";
    return `-${startDate || "start"}-to-${endDate || "end"}`;
}

function buildAdminActivityExportRows(logs) {
    return [
        ["TaskFlow Activity Log"],
        ["Exported At", formatDateTime(new Date().toISOString())],
        [],
        ["Timestamp", "User", "Action", "Details"],
        ...logs.map((log) => [
            formatDateTime(log?.timestamp),
            log?.user_email || log?.username || "-",
            log?.action || "-",
            typeof formatActivityLogDetails === "function"
                ? formatActivityLogDetails(log)
                : [log?.target, log?.details].filter(Boolean).join(" | ") || "-"
        ])
    ];
}

function exportAdminActivityLogPdf(rows, filename) {
    if (!window.jspdf?.jsPDF || typeof window.jspdf.jsPDF !== "function") {
        alert("PDF export is not available right now. Please refresh and try again.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("p", "mm", "a4");
    let currentY = 18;
    let headers = [];
    let body = [];

    doc.setFontSize(18);
    doc.text("TaskFlow Activity Log", 14, currentY);
    currentY += 8;

    const flushTable = () => {
        if (!headers.length) return;

        doc.autoTable({
            startY: currentY,
            head: [headers],
            body,
            theme: "grid",
            styles: {
                fontSize: 8,
                cellPadding: 2,
                overflow: "linebreak"
            },
            headStyles: {
                fillColor: [22, 163, 74]
            },
            margin: { left: 10, right: 10 }
        });

        currentY = doc.lastAutoTable.finalY + 8;
        headers = [];
        body = [];
    };

    rows.forEach((row) => {
        if (!row.length) return;

        if (row.length === 1) {
            flushTable();
            doc.setFontSize(13);
            doc.text(String(row[0]), 14, currentY);
            currentY += 7;
            return;
        }

        if (row.length === 2 && row[0] === "Exported At") {
            doc.setFontSize(10);
            doc.text(`Exported At: ${row[1]}`, 14, currentY);
            currentY += 8;
            return;
        }

        if (!headers.length) {
            headers = row;
            return;
        }

        body.push(row);
    });

    flushTable();
    doc.save(`${filename}.pdf`);
}

function exportAdminActivityLogExcel(rows, filename) {
    if (!window.XLSX) {
        alert("Excel export is not available right now. Please refresh and try again.");
        return;
    }

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = [
        { wch: 26 },
        { wch: 34 },
        { wch: 22 },
        { wch: 70 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Activity Log");
    XLSX.writeFile(workbook, `${filename}.xlsx`);
}

async function exportActivityLog(format = "pdf") {
    let logs = [];

    if (typeof getActivityLogFilteredEntries === "function") {
        logs = getActivityLogFilteredEntries();
    }

    if (!Array.isArray(logs) || !logs.length) {
        if (typeof loadActivityLog === "function") {
            await loadActivityLog();
        }

        if (typeof getActivityLogFilteredEntries === "function") {
            logs = getActivityLogFilteredEntries();
        }
    }

    if (!Array.isArray(logs) || !logs.length) {
        alert("No activity records found for the current filters.");
        return;
    }

    const rows = buildAdminActivityExportRows(logs);
    const filename = `taskflow-activity-log${getAdminActivityLogExportRangeLabel()}`;

    if (format === "excel") {
        exportAdminActivityLogExcel(rows, filename);
        return;
    }

    if (format === "csv") {
        const csv = rows.map((row) =>
            row.map((value) => {
                const text = String(value ?? "");
                return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
            }).join(",")
        ).join("\n");

        downloadAdminBlob(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
        return;
    }

    exportAdminActivityLogPdf(rows, filename);
}

function renderActivityLogView() {
    document.getElementById("mainContent").innerHTML = `
        <div id="activity-view" class="list-view admin-activity-log-view">
            ${renderCommonPageLayout({
                pageClass: "admin-module-page admin-activity-page",
                header: renderCommonPageHeader(
                    "Activity Log",
                    "Review workspace activity across users, projects, tasks, and files.",
                    "",
                    `
                        

                            <div class="admin-activity-date-control activity-log-date-control">
                                <button class="action-btn common-action-btn secondary-btn" type="button" onclick="toggleActivityLogDatePicker(event)">
                                <i class="far fa-calendar"></i>
                                <span id="activity-log-date-label">All dates</span>
                                <i class="fas fa-chevron-down"></i>
                                </button>
                                <div class="admin-activity-date-popover hidden" id="activity-log-date-popover">
                                    <label>
                                        <span>From</span>
                                        <input id="activityLogStartDate" type="date" onchange="onActivityLogDateChange()" aria-label="Filter activity log from date">
                                    </label>
                                    <label>
                                        <span>To</span>
                                        <input id="activityLogEndDate" type="date" onchange="onActivityLogDateChange()" aria-label="Filter activity log to date">
                                    </label>
                                    <button class="action-btn common-action-btn secondary-btn" type="button" onclick="clearActivityLogDateRange()">Clear dates</button>
                                </div>
                            </div>

                            
                            <button class="action-btn common-action-btn export-btn" type="button" onclick="exportActivityLog()">
                                <i class="fas fa-file-export"></i>
                                Export
                            </button>
                        </div>
                    `
                ),
                content: renderCommonContentCard(`
                    <div class="admin-activity-log-meta">
                        <span id="activity-log-filter-summary">Loading activity records...</span>
                    </div>

                    <div class="table-scroll common-table-wrapper">
                        <table class="admin-compact-table admin-activity-log-table">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>User</th>
                                    <th>Action</th>
                                    <th>Details</th>
                                </tr>
                            </thead>
                            <tbody id="activity-log-body">
                                <tr><td colspan="4">Loading activity log...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="task-pagination admin-activity-log-pagination" id="activityLogPagination"></div>
                `, "admin-activity-log-panel")
            })}
        </div>
    `;

    if (typeof updateActivityLogDateLabel === "function") {
        updateActivityLogDateLabel();
    }
    if (typeof loadActivityLog === "function") {
        loadActivityLog();
    }
}

async function renderFilesView() {
    bindAdminFileAssigneePopoverPositioning();
    const token = sessionStorage.getItem("token");

    const res = await fetch(`${BASE_URL}/files`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    const files = await res.json();
    const searchValue = String(adminState.searchTerm || "").trim().toLowerCase();
    const filteredFiles = (Array.isArray(files) ? files : [])
        .filter((file) => {
            if (!searchValue) return true;
            const haystack = [
                file.name,
                file.owner_name,
                file.owner_email,
                file.extension,
                file.task_title,
                file.source
            ].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(searchValue);
        })
        .filter((file) => adminFileFilters.category === "all" || getAdminFileCategory(file) === adminFileFilters.category)
        .sort((a, b) => sortAdminFiles(a, b, adminFileFilters.sort));
    const totalPages = Math.max(Math.ceil(filteredFiles.length / adminFileFilters.pageSize), 1);
    adminFileFilters.page = Math.min(Math.max(adminFileFilters.page, 1), totalPages);
    const startIndex = (adminFileFilters.page - 1) * adminFileFilters.pageSize;
    const pageFiles = filteredFiles.slice(startIndex, startIndex + adminFileFilters.pageSize);

    document.getElementById("mainContent").innerHTML = `
        <div class="list-view admin-files-view">
            ${renderCommonPageLayout({
                pageClass: "admin-module-page admin-files-page",
                header: renderCommonPageHeader(
                    "Files",
                    "Upload, sort, and manage shared files with the same reusable admin layout system.",
                    "",
                    `
                        <div class="common-toolbar">
                            <select class="common-filter-select" onchange="setAdminFileCategoryFilter(this.value)" aria-label="Filter files by category">
                                <option value="all" ${adminFileFilters.category === "all" ? "selected" : ""}>All Categories</option>
                                <option value="documents" ${adminFileFilters.category === "documents" ? "selected" : ""}>Documents</option>
                                <option value="images" ${adminFileFilters.category === "images" ? "selected" : ""}>Images</option>
                                <option value="videos" ${adminFileFilters.category === "videos" ? "selected" : ""}>Videos</option>
                                <option value="archives" ${adminFileFilters.category === "archives" ? "selected" : ""}>Archives</option>
                                <option value="others" ${adminFileFilters.category === "others" ? "selected" : ""}>Others</option>
                            </select>
                            <select class="common-filter-select" onchange="setAdminFileSort(this.value)" aria-label="Sort files">
                                <option value="date-desc" ${adminFileFilters.sort === "date-desc" ? "selected" : ""}>Newest First</option>
                                <option value="date-asc" ${adminFileFilters.sort === "date-asc" ? "selected" : ""}>Oldest First</option>
                                <option value="name-asc" ${adminFileFilters.sort === "name-asc" ? "selected" : ""}>Name A-Z</option>
                                <option value="name-desc" ${adminFileFilters.sort === "name-desc" ? "selected" : ""}>Name Z-A</option>
                            </select>
                            
                            <button class="action-btn common-action-btn admin-add-user-btn" type="button" onclick="triggerAdminFileUpload()">
                                <i class="fas fa-upload"></i>
                                Upload File
                            </button>
                        </div>
                    `
                ),
                content: renderCommonContentCard(`
                    <div class="data-table-wrap common-table-wrapper">
                        <table class="admin-table admin-files-table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>File</th>
                                <th>Owner</th>
                                <th>Assigned To</th>
                                <th>Category</th>
                                <th>Size</th>
                                <th>Updated</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pageFiles.length ? pageFiles.map(file => `
                                <tr>
                                    <td><i class="far fa-star star-icon" onclick="toggleStar(this)"></i></td>
                                    <td>${escapeHtml(file.name || "Untitled file")}</td>
                                    <td>${escapeHtml(file.owner_name || file.owner_email || "Unknown")}</td>
                                    <td class="admin-file-assigned-to">${renderAdminFileAssignedTo(file)}</td>
                                    <td>${escapeHtml(capitalize(getAdminFileCategory(file)))}</td>
                                    <td>${escapeHtml(file.size_label || formatSize(file.size))}</td>
                                    <td>${escapeHtml(formatDate(file.uploaded_at))}</td>
                                    <td>
                                        <button class="action-btn common-icon-btn" type="button" onclick="adminDownloadFile('${escapeHtml(encodeURIComponent(file.storage_name || file.name || ""))}')">
                                            <i class="fas fa-download"></i>
                                        </button>
                                        <button class="action-btn delete-btn common-icon-btn" type="button" onclick="adminDeleteFile('${escapeHtml(encodeURIComponent(file.storage_name || file.name || ""))}')">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join("") : `
                                <tr><td colspan="8" class="empty-state">${adminState.searchTerm ? "No results found" : "No files found"}</td></tr>
                            `}
                        </tbody>
                        </table>
                    </div>
                    <div class="admin-task-footer">
                        <span class="app-pagination-summary">${filteredFiles.length ? `Showing ${startIndex + 1} to ${startIndex + pageFiles.length} of ${filteredFiles.length} files` : "Showing 0 files"}</span>
                        <div class="admin-task-pagination-controls app-pagination-controls">
                            <button class="admin-task-page-btn app-page-btn" type="button" onclick="setAdminFilePage(${adminFileFilters.page - 1})" ${adminFileFilters.page <= 1 ? "disabled" : ""} aria-label="Previous files page">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <span class="admin-task-page-current app-page-current">${adminFileFilters.page}</span>
                            <button class="admin-task-page-btn app-page-btn" type="button" onclick="setAdminFilePage(${adminFileFilters.page + 1})" ${adminFileFilters.page >= totalPages ? "disabled" : ""} aria-label="Next files page">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                    </div>
                `)
            })}
        </div>
    `;
}

function renderAdminFileAssignedTo(file) {
    const assigned = Array.isArray(file?.shared_with)
        ? file.shared_with.map(email => String(email || "").trim()).filter(Boolean)
        : [];

    if (!assigned.length) {
        return `<span class="admin-file-unassigned">Unassigned</span>`;
    }
    const visibleAssignees = assigned.slice(0, 3);
    const hiddenCount = Math.max(0, assigned.length - 3);
    const assigneeRows = assigned.map(email => {
        const name = getAdminUserDisplayName(email);
        return `
            <li class="file-assignee-popover-person">
                <span class="file-assignee-popover-avatar">${escapeHtml(getInitial(name || email))}</span>
                <span>
                    <strong>${escapeHtml(name)}</strong>
                    <small>${escapeHtml(email)}</small>
                </span>
            </li>
        `;
    }).join("");

    return `
        <div class="admin-file-assigned-list file-assignee-preview" tabindex="0" aria-label="Assigned to ${assigned.length} people">
            <div class="file-assignee-avatar-stack">
            ${visibleAssignees.map(email => {
                const name = getAdminUserDisplayName(email);
                return `
                    <span class="admin-file-assigned-pill file-assignee-avatar" title="${escapeHtml(name)} (${escapeHtml(email)})">
                        ${escapeHtml(getInitial(name || email))}
                    </span>
                `;
            }).join("")}
            ${hiddenCount > 0
                ? `<span class="admin-file-assigned-more file-assignee-more">+${hiddenCount}</span>`
                : ""}
            </div>
            <div class="file-assignee-popover" role="tooltip">
                <div class="file-assignee-popover-head">
                    <strong>Assigned to</strong>
                    <span>People who have access to this file</span>
                </div>
                <ul>${assigneeRows}</ul>
                <p>Total ${assigned.length} ${assigned.length === 1 ? "person" : "people"}</p>
            </div>
        </div>
    `;
}

function bindAdminFileAssigneePopoverPositioning() {
    if (adminFileAssigneePopoverBound) return;

    const setActivePreview = (target) => {
        const preview = target?.closest?.(".file-assignee-preview");
        if (!preview) return;
        activeAdminFileAssigneePreview = preview;
        positionAdminFileAssigneePopover(preview);
    };

    document.addEventListener("pointerover", event => setActivePreview(event.target), true);
    document.addEventListener("focusin", event => setActivePreview(event.target), true);
    document.addEventListener("pointerout", event => {
        if (!activeAdminFileAssigneePreview) return;
        if (activeAdminFileAssigneePreview.contains(event.relatedTarget)) return;
        activeAdminFileAssigneePreview = null;
    }, true);

    const repositionActivePopover = () => {
        if (activeAdminFileAssigneePreview) {
            positionAdminFileAssigneePopover(activeAdminFileAssigneePreview);
        }
    };

    window.addEventListener("scroll", repositionActivePopover, true);
    window.addEventListener("resize", repositionActivePopover);
    adminFileAssigneePopoverBound = true;
}

function positionAdminFileAssigneePopover(preview) {
    const popover = preview?.querySelector?.(".file-assignee-popover");
    if (!popover) return;

    const margin = 12;
    const rect = preview.getBoundingClientRect();
    const popoverWidth = popover.offsetWidth || 250;
    const popoverHeight = Math.min(popover.scrollHeight || popover.offsetHeight || 220, window.innerHeight - (margin * 2));
    let left = rect.left + Math.min(28, rect.width / 2);
    let top = rect.bottom + 8;

    if (left + popoverWidth > window.innerWidth - margin) {
        left = window.innerWidth - margin - popoverWidth;
    }
    if (left < margin) {
        left = margin;
    }

    if (top + popoverHeight > window.innerHeight - margin && rect.top > popoverHeight + margin) {
        top = rect.top - popoverHeight - 8;
    }
    if (top + popoverHeight > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - margin - popoverHeight);
    }

    popover.style.setProperty("--file-assignee-popover-left", `${Math.round(left)}px`);
    popover.style.setProperty("--file-assignee-popover-top", `${Math.round(top)}px`);
}

function getAdminFileKey(file) {
    const base = String(file?.id || file?.file_id || file?.filename || file?.stored_name || file?.name || "").trim();
    const uploaded = String(file?.uploaded_at || file?.created_at || "").trim();
    return `${base}::${uploaded}`;
}

function toggleAdminFileAssigneeRow(fileKey) {
    if (!fileKey) return;
    if (expandedAdminFileAssigneeRows.has(fileKey)) {
        expandedAdminFileAssigneeRows.delete(fileKey);
    } else {
        expandedAdminFileAssigneeRows.add(fileKey);
    }
    renderFilesView();
}

async function adminDownloadFile(name) {
    const token = sessionStorage.getItem("token");
    const resolvedName = decodeURIComponent(String(name || ""));

    const res = await fetch(`${BASE_URL}/files/download/${encodeURIComponent(resolvedName)}`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = resolvedName;
    a.click();
}
async function adminDeleteFile(name) {
    const token = sessionStorage.getItem("token");
    const resolvedName = decodeURIComponent(String(name || ""));

    if (!confirm(`Delete ${resolvedName}?`)) return;

    const res = await fetch(`${BASE_URL}/files/${encodeURIComponent(resolvedName)}`, {
        method: "DELETE",
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    if (res.ok) {
        alert("Deleted successfully");
        renderFilesView();
    } else {
        const data = await res.json();
        alert(data.detail || "Delete failed");
    }
}

function getAdminFileCategory(file) {
    const ext = String(file?.extension || "").toLowerCase();
    if (["doc", "docx", "pdf", "txt", "rtf", "odt"].includes(ext)) return "documents";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "images";
    if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "videos";
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archives";
    return "others";
}

function sortAdminFiles(a, b, sortKey) {
    if (sortKey === "name-asc") return String(a.name || "").localeCompare(String(b.name || ""));
    if (sortKey === "name-desc") return String(b.name || "").localeCompare(String(a.name || ""));
    if (sortKey === "date-asc") return new Date(a.uploaded_at || 0) - new Date(b.uploaded_at || 0);
    return new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0);
}

function setAdminFileCategoryFilter(value) {
    adminFileFilters.category = value || "all";
    adminFileFilters.page = 1;
    renderFilesView();
}

function setAdminFileSort(value) {
    adminFileFilters.sort = value || "date-desc";
    adminFileFilters.page = 1;
    renderFilesView();
}

function setAdminFilePage(page) {
    adminFileFilters.page = page;
    renderFilesView();
}

function resetAdminFileFilters() {
    adminFileFilters.category = "all";
    adminFileFilters.sort = "date-desc";
    adminFileFilters.page = 1;
    renderFilesView();
}

function triggerAdminFileUpload() {
    const role = sessionStorage.getItem("role");
    if (role !== "admin") {
        showNotification("Only admins can upload and assign files from the admin dashboard.", "error");
        return;
    }

    resetAdminFileUploadModal();
    populateAdminFileProjectOptions();
    renderAdminFileTaskOptions();
    renderAdminFileAssigneeChips();
    renderAdminFileAssigneeOptions();
    bindAdminFileDropZone();

    const modal = document.getElementById("admin-file-upload-modal");
    if (modal) {
        modal.classList.remove("hidden");
        document.body.classList.add("admin-file-upload-modal-open");
    }
}

async function handleAdminFileUpload(event) {
    const token = sessionStorage.getItem("token");
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;

    try {
        for (const file of files) {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch(`${BASE_URL}/files/upload`, {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + token
                },
                body: formData
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || data.message || `Unable to upload ${file.name}.`);
            }
        }

        event.target.value = "";
        showNotification(files.length === 1 ? "File uploaded successfully." : `${files.length} files uploaded successfully.`);
        renderFilesView();
    } catch (error) {
        console.error("Failed to upload admin files", error);
        showNotification(error.message || "Upload failed.", "error");
    }
}

function closeAdminFileUploadModal() {
    const modal = document.getElementById("admin-file-upload-modal");
    if (modal) modal.classList.add("hidden");
    document.body.classList.remove("admin-file-upload-modal-open");
    closeAdminFileAssigneeMenu();
}

function resetAdminFileUploadModal() {
    adminFileUploadSelectedFile = null;
    adminFileUploadSelectedAssignees = [];

    const input = document.getElementById("admin-modal-file-input");
    const message = document.getElementById("admin-file-upload-message");
    const selectedName = document.getElementById("adminSelectedFileName");
    const dropTitle = document.getElementById("adminFileDropTitle");
    const dropSubtitle = document.getElementById("adminFileDropSubtitle");
    const taskSelect = document.getElementById("admin-file-task-select");
    const search = document.getElementById("admin-file-assignee-search");
    const submit = document.getElementById("admin-send-file-btn");

    if (input) input.value = "";
    if (message) message.value = "";
    if (taskSelect) {
        taskSelect.innerHTML = `<option value="">Select a project first</option>`;
        taskSelect.disabled = true;
    }
    if (search) search.value = "";
    if (selectedName) selectedName.textContent = "Max file size: 100 MB";
    if (dropTitle) dropTitle.textContent = "Drag & drop your file here";
    if (dropSubtitle) dropSubtitle.textContent = "or";
    if (submit) {
        submit.disabled = false;
        submit.querySelector("span").textContent = "Send File";
    }

    updateAdminFileUploadMessageCount();
}

function populateAdminFileProjectOptions() {
    const select = document.getElementById("admin-file-project-select");
    if (!select) return;

    const projects = Array.isArray(adminState.projects) ? adminState.projects : [];
    if (!projects.length) {
        select.innerHTML = `<option value="">No projects available</option>`;
        select.disabled = true;
        return;
    }

    select.disabled = false;
    select.innerHTML = `
        <option value="">Select project</option>
        ${projects.map(project => `
            <option value="${escapeHtml(project.id)}">${escapeHtml(project.name || project.project_name || "Untitled Project")}</option>
        `).join("")}
    `;
}

function getSelectedAdminFileProjectId() {
    return document.getElementById("admin-file-project-select")?.value || "";
}

function getSelectedAdminFileTaskId() {
    return document.getElementById("admin-file-task-select")?.value || "";
}

function getAdminFileProjectTasks() {
    const projectId = getSelectedAdminFileProjectId();
    if (!projectId) return [];
    return (Array.isArray(adminState.tasks) ? adminState.tasks : [])
        .filter(task => String(task.project_id) === String(projectId));
}

function renderAdminFileTaskOptions() {
    const select = document.getElementById("admin-file-task-select");
    if (!select) return;

    const projectId = getSelectedAdminFileProjectId();
    if (!projectId) {
        select.innerHTML = `<option value="">Select a project first</option>`;
        select.disabled = true;
        return;
    }

    const tasks = getAdminFileProjectTasks();
    if (!tasks.length) {
        select.innerHTML = `<option value="">No tasks in this project</option>`;
        select.disabled = true;
        return;
    }

    select.disabled = false;
    select.innerHTML = `
        <option value="">Select task</option>
        ${tasks.map(task => `
            <option value="${escapeHtml(task.id)}">${escapeHtml(task.title || task.task_title || "Untitled Task")}</option>
        `).join("")}
    `;
}

function handleAdminFileProjectChange() {
    const taskSelect = document.getElementById("admin-file-task-select");
    if (taskSelect) taskSelect.value = "";
    renderAdminFileTaskOptions();
    const allowedEmails = new Set(getAdminFileAssignableUsers().map(user => user.email));
    adminFileUploadSelectedAssignees = adminFileUploadSelectedAssignees.filter(email => allowedEmails.has(email));
    renderAdminFileAssigneeChips();
    renderAdminFileAssigneeOptions();
}

function handleAdminFileTaskChange() {
    const allowedEmails = new Set(getAdminFileAssignableUsers().map(user => user.email));
    adminFileUploadSelectedAssignees = adminFileUploadSelectedAssignees.filter(email => allowedEmails.has(email));
    renderAdminFileAssigneeChips();
    renderAdminFileAssigneeOptions();
}

function handleAdminModalFileSelection(event) {
    const file = event.target.files?.[0];
    setAdminFileUploadSelectedFile(file);
}

function setAdminFileUploadSelectedFile(file) {
    if (!file) return;

    const maxBytes = 100 * 1024 * 1024;
    if (file.size > maxBytes) {
        showNotification("File is too large. Maximum size is 100 MB.", "error");
        return;
    }

    adminFileUploadSelectedFile = file;

    const selectedName = document.getElementById("adminSelectedFileName");
    const dropTitle = document.getElementById("adminFileDropTitle");
    const dropSubtitle = document.getElementById("adminFileDropSubtitle");

    if (selectedName) selectedName.textContent = `${file.name} - ${formatSize(file.size)}`;
    if (dropTitle) dropTitle.textContent = "File ready to send";
    if (dropSubtitle) dropSubtitle.textContent = "Choose another file if needed";
}

function bindAdminFileDropZone() {
    const zone = document.getElementById("adminFileDropZone");
    if (!zone || zone.dataset.bound === "true") return;

    zone.dataset.bound = "true";

    ["dragenter", "dragover"].forEach(eventName => {
        zone.addEventListener(eventName, event => {
            event.preventDefault();
            zone.classList.add("drag-over");
        });
    });

    ["dragleave", "drop"].forEach(eventName => {
        zone.addEventListener(eventName, event => {
            event.preventDefault();
            zone.classList.remove("drag-over");
        });
    });

    zone.addEventListener("drop", event => {
        const file = event.dataTransfer?.files?.[0];
        setAdminFileUploadSelectedFile(file);
    });
}

function getAdminFileAssignableUsers() {
    const projectId = getSelectedAdminFileProjectId();
    const taskId = getSelectedAdminFileTaskId();
    const project = (Array.isArray(adminState.projects) ? adminState.projects : [])
        .find(item => String(item.id) === String(projectId));
    const managerEmails = new Set();
    const relatedEmails = new Set();

    if (project) {
        [
            project.assigned_manager,
            project.owner_email,
            project.manager_email
        ].forEach(email => {
            const normalized = String(email || "").trim().toLowerCase();
            if (normalized) {
                managerEmails.add(normalized);
                relatedEmails.add(normalized);
            }
        });

        if (taskId) {
            const task = (Array.isArray(adminState.tasks) ? adminState.tasks : [])
                .find(item => String(item.id) === String(taskId));
            if (task) {
                getTaskAssignments(task).forEach(assignment => {
                    const normalized = String(assignment.user_id || "").trim().toLowerCase();
                    if (normalized) relatedEmails.add(normalized);
                });
            }
        }
    }

    return (Array.isArray(adminState.users) ? adminState.users : [])
        .map(user => ({
            ...user,
            email: String(user.email || "").trim().toLowerCase(),
            username: String(user.username || user.name || user.email || "").trim(),
            role: String(user.role || "").toLowerCase()
        }))
        .filter(user => {
            if (!user.email || !project) return false;
            if (!taskId) {
                return user.role === "manager" && managerEmails.has(user.email);
            }
            return relatedEmails.has(user.email) && (user.role === "user" || user.role === "manager");
        })
        .sort((a, b) => a.email.localeCompare(b.email));
}

function renderAdminFileAssigneeOptions() {
    const list = document.getElementById("admin-file-assignee-options");
    const search = document.getElementById("admin-file-assignee-search");
    if (!list) return;

    const query = String(search?.value || "").trim().toLowerCase();
    const users = getAdminFileAssignableUsers().filter(user => {
        const text = `${user.username || ""} ${user.email || ""}`.toLowerCase();
        return !query || text.includes(query);
    });

    if (!users.length) {
        const taskId = getSelectedAdminFileTaskId();
        const projectId = getSelectedAdminFileProjectId();
        const emptyText = taskId
            ? "No related users found for this task"
            : projectId
                ? "No project manager found for this project"
                : "Select a project first";
        list.innerHTML = `<p class="admin-file-assignee-empty">${emptyText}</p>`;
        return;
    }

    list.innerHTML = users.map(user => {
        const checked = adminFileUploadSelectedAssignees.includes(user.email);
        const label = user.username || user.email;
        return `
            <label class="admin-file-assignee-option">
                <input type="checkbox" value="${escapeHtml(user.email)}" ${checked ? "checked" : ""} onchange="toggleAdminFileUploadAssignee('${escapeHtml(user.email)}')">
                <span class="admin-file-option-avatar">${escapeHtml(getInitial(label))}</span>
                <span>
                    <strong>${escapeHtml(label)}</strong>
                    <small>${escapeHtml(user.email)}</small>
                </span>
            </label>
        `;
    }).join("");
}

function toggleAdminFileUploadAssignee(email) {
    const normalized = String(email || "").trim().toLowerCase();
    if (!normalized) return;

    if (adminFileUploadSelectedAssignees.includes(normalized)) {
        adminFileUploadSelectedAssignees = adminFileUploadSelectedAssignees.filter(item => item !== normalized);
    } else {
        adminFileUploadSelectedAssignees.push(normalized);
    }

    renderAdminFileAssigneeChips();
    renderAdminFileAssigneeOptions();
}

function renderAdminFileAssigneeChips() {
    const chips = document.getElementById("admin-file-assignee-chips");
    if (!chips) return;

    if (!adminFileUploadSelectedAssignees.length) {
        chips.textContent = "Select team members";
        chips.classList.add("empty");
        return;
    }

    chips.classList.remove("empty");
    const userDirectory = Array.isArray(adminState.users)
        ? adminState.users.map(item => ({
            email: String(item.email || "").trim().toLowerCase(),
            username: String(item.username || item.name || item.email || "").trim()
        }))
        : [];

    chips.innerHTML = adminFileUploadSelectedAssignees.map(email => {
        const user = userDirectory.find(item => item.email === String(email || "").trim().toLowerCase());
        const label = user?.username || email;
        return `
            <span class="admin-file-assignee-chip">
                <strong>${escapeHtml(getInitial(label))}</strong>
                ${escapeHtml(label)}
                <button type="button" onclick="removeAdminFileUploadAssignee('${escapeHtml(email)}', event)" aria-label="Remove ${escapeHtml(label)}">
                    <i class="fas fa-xmark"></i>
                </button>
            </span>
        `;
    }).join("");
}

async function submitAdminAssignedFile() {
    if (sessionStorage.getItem("role") !== "admin") {
        showNotification("Only admins can upload and assign files from the admin dashboard.", "error");
        return;
    }

    if (!adminFileUploadSelectedFile) {
        showNotification("Please choose a file first.", "error");
        return;
    }

    const token = sessionStorage.getItem("token");
    const projectSelect = document.getElementById("admin-file-project-select");
    const projectId = projectSelect?.value || "";
    const project = adminState.projects.find(item => String(item.id) === String(projectId));
    const taskId = getSelectedAdminFileTaskId();
    const task = (Array.isArray(adminState.tasks) ? adminState.tasks : []).find(item => String(item.id) === String(taskId));
    const message = document.getElementById("admin-file-upload-message")?.value || "";
    const submit = document.getElementById("admin-send-file-btn");

    if (!taskId) {
        showNotification("Please select a task before assigning the file.", "error");
        return;
    }

    try {
        if (submit) {
            submit.disabled = true;
            submit.querySelector("span").textContent = "Sending...";
        }

        const formData = new FormData();
        formData.append("file", adminFileUploadSelectedFile);
        formData.append("project_id", projectId);
        formData.append("project_name", project?.name || project?.project_name || "");
        formData.append("task_id", taskId);
        formData.append("task_title", task?.title || task?.task_title || "");
        formData.append("message", message.trim());
        formData.append("shared_with", JSON.stringify(adminFileUploadSelectedAssignees));

        const response = await fetch(`${BASE_URL}/files/upload`, {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + token
            },
            body: formData
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.detail || data.message || "Upload failed.");
        }

        closeAdminFileUploadModal();
        showNotification("File uploaded and assigned successfully.");
        renderFilesView();
    } catch (error) {
        console.error("Failed to upload assigned admin file", error);
        showNotification(error.message || "Upload failed.", "error");
    } finally {
        if (submit) {
            submit.disabled = false;
            submit.querySelector("span").textContent = "Send File";
        }
    }
}
function toggleAdminFileAssigneeMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById("admin-file-assignee-menu");
    if (menu) menu.classList.toggle("hidden");
}

function closeAdminFileAssigneeMenu() {
    const menu = document.getElementById("admin-file-assignee-menu");
    if (menu) menu.classList.add("hidden");
}

function removeAdminFileUploadAssignee(email, event) {
    if (event) event.stopPropagation();
    adminFileUploadSelectedAssignees = adminFileUploadSelectedAssignees.filter(item => item !== email);
    renderAdminFileAssigneeChips();
    renderAdminFileAssigneeOptions();
}


function updateAdminFileUploadMessageCount() {
    const message = document.getElementById("admin-file-upload-message");
    const count = document.getElementById("admin-file-upload-message-count");
    if (count) count.textContent = `${String(message?.value || "").length}/200`;
}


function renderSettingsView() {
    document.getElementById("mainContent").innerHTML = `
        ${renderCommonPageLayout({
            pageClass: "admin-module-page settings-page admin-settings-page",
            header: `
                <header class="common-page-header settings-heading">
                    <div class="common-page-title">
                        <h1 class="settings-title" data-admin-settings-text="title">Settings</h1>
                        <p data-admin-settings-text="subtitle">Manage your account and preferences.</p>
                    </div>
                </header>
            `,
            content: `
                <section class="settings-list-card">
                <button class="settings-row" type="button" onclick="goToProfile()">
                    <span class="settings-row-icon"><i class="far fa-user"></i></span>
                    <span class="settings-row-copy">
                        <strong data-admin-settings-text="profileTitle">Profile</strong>
                        <small data-admin-settings-text="profileCopy">View and update your personal information.</small>
                    </span>
                    <i class="fas fa-chevron-right settings-row-chevron"></i>
                </button>

                <button class="settings-row" type="button" onclick="toggleAdminQuietNotifications()">
                    <span class="settings-row-icon"><i class="far fa-bell"></i></span>
                    <span class="settings-row-copy">
                        <strong data-admin-settings-text="notificationsTitle">Notifications</strong>
                        <small data-admin-settings-text="notificationsCopy">Manage your notification preferences.</small>
                    </span>
                    <span class="settings-status-pill" id="admin-settings-notification-state">On</span>
                </button>

                <button class="settings-row" type="button" onclick="window.location.href='/forgot-page'">
                    <span class="settings-row-icon"><i class="fas fa-lock"></i></span>
                    <span class="settings-row-copy">
                        <strong data-admin-settings-text="securityTitle">Security</strong>
                        <small data-admin-settings-text="securityCopy">Change your password and security settings.</small>
                    </span>
                    <i class="fas fa-chevron-right settings-row-chevron"></i>
                </button>

                <div class="settings-row">
                    <span class="settings-row-icon"><i class="fas fa-palette"></i></span>
                    <span class="settings-row-copy">
                        <strong data-admin-settings-text="appearanceTitle">Appearance</strong>
                        <small data-admin-settings-text="appearanceCopy">Choose your preferred theme.</small>
                    </span>
                    <select id="admin-settings-theme-select" class="settings-select" onchange="saveAdminSettingsPreference('theme', this.value)" aria-label="Choose appearance theme">
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="system">System</option>
                    </select>
                </div>

                <div class="settings-row">
                    <span class="settings-row-icon"><i class="fas fa-globe"></i></span>
                    <span class="settings-row-copy">
                        <strong data-admin-settings-text="languageTitle">Language</strong>
                        <small data-admin-settings-text="languageCopy">Select your preferred language.</small>
                    </span>
                    <select id="admin-settings-language-select"
                            class="settings-select"
                            onchange="applyAdminGoogleLanguage(this.value)">
                        <option value="en">English</option>
                        <option value="hi">Hindi</option>
                    </select>
                </div>
                </section>
            `
        })}
    `;
    loadAdminSettingsView();
}

function renderProfileView() {
    const username = sessionStorage.getItem("username") || "Admin";
    const email = sessionStorage.getItem("email") || "";
    const role = sessionStorage.getItem("role") || "admin";
    const roleText = capitalize(role);
    const initial = (username || email || "A").charAt(0).toUpperCase();

    document.getElementById("mainContent").innerHTML = `
        <section class="dashboard-profile-page admin-profile-page">
            <div class="profile-page-head">
                <div>
                    <h1 class="profile-page-title">My Profile</h1>
                </div>
                <button class="profile-action-btn" type="button" onclick="goToSettings()">
                    <i class="fas fa-gear"></i>
                    <span>Settings</span>
                </button>
            </div>

            <div class="dashboard-profile-grid">
                <section class="dashboard-profile-card profile-identity-card">
                    <div class="profile-avatar-wrap">
                        <div class="dashboard-profile-avatar-large">${escapeHtml(initial)}</div>
                        <button type="button" class="profile-camera-btn" aria-label="Change photo">
                            <i class="fas fa-camera"></i>
                        </button>
                    </div>

                    <h2>${escapeHtml(username)}</h2>
                    <p>${escapeHtml(roleText)}</p>
                </section>

                <section class="dashboard-profile-card profile-details-card">
                    <div class="profile-card-head">
                        <div class="profile-card-icon"><i class="fas fa-id-card"></i></div>
                        <div>
                            <h3>Profile Details</h3>
                            <p>Account information used across TaskFlow.</p>
                        </div>
                    </div>

                    <div class="profile-detail-list">
                        <div class="profile-detail-row">
                            <span>Full Name</span>
                            <strong>${escapeHtml(username)}</strong>
                        </div>
                        <div class="profile-detail-row">
                            <span>Email</span>
                            <strong>${escapeHtml(email || "-")}</strong>
                        </div>
                        <div class="profile-detail-row">
                            <span>Role</span>
                            <strong>${escapeHtml(roleText)}</strong>
                        </div>
                    </div>
                </section>

                <section class="dashboard-profile-card profile-details-card">
                    <div class="profile-card-head">
                        <div class="profile-card-icon"><i class="fas fa-shield-halved"></i></div>
                        <div>
                            <h3>Account Access</h3>
                            <p>Manage security and active session actions.</p>
                        </div>
                    </div>

                    <div class="profile-action-list">
                        <button class="profile-list-button" type="button" onclick="window.location.href='/forgot-page'">
                            <span><i class="fas fa-key"></i>Reset password</span>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                        <button class="profile-list-button" type="button" onclick="goToSettings()">
                            <span><i class="fas fa-sliders"></i>Dashboard preferences</span>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                        <button class="profile-list-button danger" type="button" onclick="logoutFromAdmin()">
                            <span><i class="fas fa-right-from-bracket"></i>Logout</span>
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </section>
            </div>
        </section>
    `;
}

function computeDashboardStats() {
    const filteredUsers = filterCollection(adminState.users, (user) => [user.username, user.email, user.role]);
    const filteredProjects = filterCollection(adminState.projects, (project) => [project.name, project.owner_email]);
    const filteredTasks = filterCollection(adminState.tasks, (task) => [task.title, getTaskMemberStatusSearchText(task), task.status, task.deadline]);
    const projectMap = new Map(adminState.projects.map((project) => [String(project.id), project]));

    const completedTasks = filteredTasks.filter((task) => isCompletedStatus(task.status)).length;
    const pendingTasks = filteredTasks.filter((task) => isPendingStatus(task.status)).length;
    const inProgressTasks = filteredTasks.filter((task) => isInProgressStatus(task.status)).length;
    const statusBreakdown = buildProjectStatus(filteredTasks);
    const weeklyOverview = buildWeeklyTaskOverview(filteredTasks);

    return {
        filteredUsers,
        filteredProjects,
        filteredTasks,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        statusBreakdown,
        weeklyOverview,
        projectMap
    };
}

function filterCollection(collection, extractFields) {
    if (!adminState.searchTerm) {
        return [...collection];
    }

    return collection.filter((item) => {
        const haystack = extractFields(item)
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        return haystack.includes(adminState.searchTerm);
    });
}

function buildProjectStatus(tasks) {
    const counts = { pending: 0, progress: 0, completed: 0, hold: 0, planning: 0 };

    tasks.forEach((task) => {
        if (isCompletedStatus(task.status)) {
            counts.completed += 1;
        } else if (isInProgressStatus(task.status)) {
            counts.progress += 1;
        } else if (statusClassName(task.status) === "on-hold") {
            counts.hold += 1;
        } else if (statusClassName(task.status) === "planning") {
            counts.planning += 1;
        } else {
            counts.pending += 1;
        }
    });

    const total = tasks.length || 1;

    return [
        {
            key: "pending",
            label: "Pending",
            value: counts.pending,
            percent: Math.round((counts.pending / total) * 100),
            color: getAdminStatusColorToken("pending")
        },
        {
            key: "completed",
            label: "Completed",
            value: counts.completed,
            percent: Math.round((counts.completed / total) * 100),
            color: getAdminStatusColorToken("completed")
        },
        {
            key: "progress",
            label: "In Progress",
            value: counts.progress,
            percent: Math.round((counts.progress / total) * 100),
            color: getAdminStatusColorToken("progress")
        },
        {
            key: "hold",
            label: "On Hold",
            value: counts.hold,
            percent: Math.round((counts.hold / total) * 100),
            color: getAdminStatusColorToken("hold")
        },
        {
            key: "planning",
            label: "Planning",
            value: counts.planning,
            percent: Math.round((counts.planning / total) * 100),
            color: getAdminStatusColorToken("planning")
        }
    ];
}

function buildWeeklyTaskOverview(tasks) {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const created = [0, 0, 0, 0, 0, 0, 0];
    const completed = [0, 0, 0, 0, 0, 0, 0];
    const trend = [0, 0, 0, 0, 0, 0, 0];

    tasks.forEach((task, index) => {
        const labelIndex = getTaskDayIndex(task, index);
        created[labelIndex] += 1;
        if (isCompletedStatus(task.status)) {
            completed[labelIndex] += 1;
        }
    });

    let running = 0;
    created.forEach((count, index) => {
        running += count;
        trend[index] = running;
    });

    return { labels, created, completed, trend };
}

function getTaskDayIndex(task, fallbackIndex) {
    const sources = [task.deadline, task.created_at, task.updated_at].filter(Boolean);

    for (const source of sources) {
        const date = new Date(source);
        if (!Number.isNaN(date.getTime())) {
            return (date.getDay() + 6) % 7;
        }
    }

    return fallbackIndex % 7;
}

function getRecentTasks(tasks) {
    return [...tasks]
        .sort((a, b) => compareDatesDesc(a.deadline, b.deadline) || String(a.title || "").localeCompare(String(b.title || "")))
        .slice(0, 3);
}

function getUpcomingDeadlines(tasks) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return [...tasks]
        .filter((task) => {
            if (!task.deadline) return false;

            const date = new Date(task.deadline);
            if (Number.isNaN(date.getTime())) return false;

            date.setHours(0, 0, 0, 0);
            return date >= today;
        })
        .sort((a, b) => compareDatesAsc(a.deadline, b.deadline))
        .slice(0, 4);
}

function renderStatusLegend(items) {
    return items.map((item) => `
        <div class="legend-item">
            <span class="legend-dot" style="background:${item.color}"></span>
            <div class="legend-copy">
                <span>${item.label}</span>
                <strong>${item.percent}%</strong>
            </div>
        </div>
    `).join("");
}

function renderRecentTasksRows(tasks, projectMap) {
    if (!tasks.length) {
        return `<tr><td colspan="5" class="empty-state">No task data available.</td></tr>`;
    }

    return tasks.map((task) => renderTaskRow(task, projectMap)).join("");
}

function renderTaskRow(task, projectMap, options = {}) {
    const project = projectMap.get(String(task.project_id));
    const label = normalizeStatusLabel(task.status);
    const className = statusClassName(task.status);
    const priority = normalizeTaskPriority(task.priority);
    const priorityClass = priority.toLowerCase().replace(/\s+/g, "-");

    return `
        <tr>
            <td><i class="far fa-star star-icon" onclick="toggleStar(this)"></i></td>
            <td>${escapeHtml(task.title || "Untitled Task")}</td>
            <td>${escapeHtml(project?.name || "Unknown Project")}</td>
            <td><span class="task-priority-pill ${priorityClass}">${escapeHtml(priority)}</span></td>
            <td>${renderAdminMemberStatuses(task)}</td>
            <td><span class="status-pill ${className}">${escapeHtml(label)}</span></td>
            <td>${escapeHtml(formatDate(task.deadline))}</td>
            ${options.showAction ? `
                <td>
                    <button class="action-btn delete-btn" type="button" onclick="adminDeleteTask('${escapeHtml(task.id)}')">Delete</button>
                </td>
            ` : ""}
        </tr>
    `;
}

function renderDeadlines(tasks, projectMap) {
    if (!tasks.length) {
        return `<div class="empty-state">No upcoming deadlines.</div>`;
    }

    const colors = ["#3f7ec8", "#ff7f1f", "#26b37b"];

    return tasks.map((task, index) => {
        const project = projectMap.get(String(task.project_id));
        return `
            <div class="deadline-item">
                <span class="deadline-icon" style="background:${colors[index % colors.length]}"><i class="fas fa-check"></i></span>
                <div class="deadline-copy">
                    <strong>${escapeHtml(task.title || project?.name || "Upcoming task")}</strong>
                    <span>${escapeHtml(formatDate(task.deadline))}</span>
                </div>
            </div>
        `;
    }).join("");
}

async function assignAdminProjectManager(event, projectId, managerEmail) {
    if (event) event.stopPropagation();
    const token = sessionStorage.getItem("token");
    const normalizedManagerEmail = String(managerEmail || "").trim().toLowerCase();

    if (!token || !projectId) {
        showNotification("Unable to assign manager right now.", "error");
        return;
    }

    if (!normalizedManagerEmail) {
        showNotification("Please select a manager.", "warning");
        await refreshAdminData();
        renderProjectsView();
        return;
    }

    try {
        const projectIndex = adminState.projects.findIndex((project) => String(project.id) === String(projectId));
        let response = await fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}/assign-manager`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                assigned_manager: normalizedManagerEmail
            })
        });

        if (response.status === 404) {
            response = await fetch(`${BASE_URL}/projects/${encodeURIComponent(projectId)}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
                body: JSON.stringify({
                    assigned_manager: normalizedManagerEmail
                })
            });
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || data.detail || "Unable to assign manager.");
        }

        if (projectIndex >= 0) {
            adminState.projects[projectIndex] = {
                ...adminState.projects[projectIndex],
                ...(data.project || {}),
                assigned_manager: String(data?.project?.assigned_manager || normalizedManagerEmail).trim().toLowerCase(),
                owner_email: String(data?.project?.owner_email || normalizedManagerEmail).trim().toLowerCase()
            };
        }

        await refreshAdminData();
        renderProjectsView();
        showNotification(data.message || "Manager assigned successfully.");
    } catch (error) {
        console.error("Failed to assign manager", error);
        await refreshAdminData();
        renderProjectsView();
        showNotification(error.message || "Unable to assign manager.", "error");
    }
}

function renderProjectStatusChart(items) {
    const canvas = document.getElementById("projectStatusChart");
    if (!canvas) {
        return;
    }

    if (projectStatusChart) {
        projectStatusChart.destroy();
    }

    projectStatusChart = new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: items.map((item) => item.label),
            datasets: [{
                data: items.map((item) => item.percent),
                backgroundColor: items.map((item) => item.color),
                borderWidth: 0,
                hoverOffset: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "58%",
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.label}: ${context.raw}%`
                    }
                }
            }
        }
    });
}

function renderTaskOverviewChart(overview) {
    const canvas = document.getElementById("tasksOverviewChart");
    if (!canvas) {
        return;
    }

    if (taskOverviewChart) {
        taskOverviewChart.destroy();
    }

    const pendingColor = getAdminStatusColorToken("pending");
    const completedColor = getAdminStatusColorToken("completed");
    const progressColor = getAdminStatusColorToken("progress");

    taskOverviewChart = new Chart(canvas, {
        data: {
            labels: overview.labels,
            datasets: [
                {
                    type: "bar",
                    label: "Created",
                    data: overview.created,
                    backgroundColor: pendingColor,
                    borderRadius: 0,
                    barThickness: 20
                },
                {
                    type: "bar",
                    label: "Completed",
                    data: overview.completed,
                    backgroundColor: completedColor,
                    borderRadius: 0,
                    barThickness: 20
                },
                {
                    type: "line",
                    label: "Trend",
                    data: overview.trend,
                    borderColor: progressColor,
                    backgroundColor: progressColor,
                    pointBackgroundColor: progressColor,
                    pointBorderColor: progressColor,
                    pointRadius: 4,
                    pointHoverRadius: 4,
                    borderWidth: 3,
                    tension: 0,
                    yAxisID: "y"
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: "#58647c",
                        font: { size: 13 }
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        color: "#58647c"
                    },
                    grid: {
                        color: "#e7ecf4"
                    }
                }
            }
        }
    });
}

async function loadAdminNotifications() {
    const token = sessionStorage.getItem("token");
    if (!token) return;

    try {
        const res = await fetch(`${BASE_URL}/notifications`, {
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        if (!res.ok) {
            throw new Error("Unable to load notifications");
        }

        const notifications = await res.json();
        adminState.rawNotifications = Array.isArray(notifications) ? notifications : [];
        adminState.notifications = buildAdminNotificationFeed(adminState.rawNotifications);
        updateNotificationCount();
        renderAdminNotifications();
    } catch (error) {
        console.error("Failed to load admin notifications", error);
        renderAdminNotificationsError();
    }
}

function updateNotificationCount() {
    const badge = document.getElementById("notificationCount");
    if (!badge) return;

    const count = adminState.notifications.filter((notification) => !notification.read && notification.category !== "system").length
        || adminState.notifications.filter((notification) => !notification.read).length;
    badge.innerText = count > 99 ? "99+" : count;
    badge.classList.toggle("hidden", count === 0);
}

function normalizeTaskPriority(priority) {
    const normalized = String(priority || "Medium").trim().toLowerCase();
    if (normalized === "urgent") return "Urgent";
    if (normalized === "high") return "High";
    if (normalized === "low") return "Low";
    return "Medium";
}

function toggleAdminNotifications(event) {
    event.stopPropagation();
    const dropdown = document.getElementById("adminNotificationDropdown");
    const button = document.getElementById("adminNotificationButton");
    if (!dropdown || !button) return;

    const isOpening = dropdown.classList.contains("hidden");
    dropdown.classList.toggle("hidden", !isOpening);
    button.classList.toggle("open", isOpening);
    button.setAttribute("aria-expanded", String(isOpening));

    if (isOpening) {
        loadAdminNotifications();
    }
}

function closeAdminNotifications() {
    const dropdown = document.getElementById("adminNotificationDropdown");
    const button = document.getElementById("adminNotificationButton");
    if (!dropdown || !button) return;

    dropdown.classList.add("hidden");
    button.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
}

function getAdminNotificationStorageKey(suffix) {
    const email = String(sessionStorage.getItem("email") || "admin").trim().toLowerCase() || "admin";
    return `admin.notifications.${email}.${suffix}`;
}

function readAdminNotificationState(suffix) {
    try {
        const raw = sessionStorage.getItem(getAdminNotificationStorageKey(suffix));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn("Unable to read notification state", error);
        return [];
    }
}

function writeAdminNotificationState(suffix, values) {
    try {
        sessionStorage.setItem(getAdminNotificationStorageKey(suffix), JSON.stringify(Array.from(new Set(values.map(String)))));
    } catch (error) {
        console.warn("Unable to store notification state", error);
    }
}

function getAdminNotificationDismissedIds() {
    return new Set(readAdminNotificationState("dismissed"));
}

function getAdminNotificationReadOverrides() {
    return new Set(readAdminNotificationState("read"));
}

function rememberAdminNotificationRead(id) {
    if (!id) return;
    const current = readAdminNotificationState("read");
    current.push(String(id));
    writeAdminNotificationState("read", current);
}

function rememberAdminNotificationDismissed(ids) {
    const current = readAdminNotificationState("dismissed");
    ids.filter(Boolean).forEach((id) => current.push(String(id)));
    writeAdminNotificationState("dismissed", current);
}

function buildAdminNotificationFeed(rawNotifications) {
    const now = Date.now();
    const dismissedIds = getAdminNotificationDismissedIds();
    const readOverrides = getAdminNotificationReadOverrides();
    const normalized = (Array.isArray(rawNotifications) ? rawNotifications : [])
        .map((notification, index) => normalizeAdminNotification(notification, index, readOverrides))
        .filter(Boolean)
        .filter((notification) => !dismissedIds.has(String(notification.id)));

    const synthetic = [
        ...buildAdminDeadlineNotifications(now, readOverrides),
        ...buildAdminProjectHealthNotifications(now, readOverrides)
    ].filter((notification) => !dismissedIds.has(String(notification.id)));

    const merged = [...normalized, ...synthetic]
        .sort((first, second) =>
            getNotificationTimeValue(second.createdAt) - getNotificationTimeValue(first.createdAt)
        )
        .slice(0, 40);

    return dedupeAdminNotifications(merged);
}

function dedupeAdminNotifications(items) {
    const seen = new Set();
    return items.filter((item) => {
        const dedupeKey = item.dedupeKey || `${item.category}|${item.title}|${item.relatedName}|${item.priority}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
    });
}

function buildAdminDeadlineNotifications(now, readOverrides = new Set()) {
    const notifications = [];
    const oneDay = 24 * 60 * 60 * 1000;

    adminState.tasks.forEach((task) => {
        const due = new Date(task.deadline || task.due_date || "");
        if (Number.isNaN(due.getTime())) return;

        const taskName = task.title || "Task";
        const project = adminState.projects.find((item) => String(item.id) === String(task.project_id));
        const projectName = project?.name || "Unknown project";
        const delta = due.getTime() - now;
        const overdue = delta < 0 && !isCompletedStatus(task.status);
        const dueSoon = delta >= 0 && delta <= 2 * oneDay && !isCompletedStatus(task.status);

        if (!overdue && !dueSoon) return;

        const id = `task-deadline-${task.id}-${due.toISOString().slice(0, 10)}`;
        notifications.push({
            id,
            sourceId: task.id,
            category: "tasks",
            level: overdue ? "error" : "warning",
            priority: overdue ? "high" : "medium",
            icon: overdue ? "fa-triangle-exclamation" : "fa-hourglass-half",
            title: overdue ? "Task overdue" : "Task deadline approaching",
            message: overdue
                ? `${taskName} is overdue and needs follow-up from the assigned team.`
                : `${taskName} is due soon and should be monitored before it slips.`,
            relatedName: `${taskName} - ${projectName}`,
            read: readOverrides.has(id),
            createdAt: task.updated_at || task.created_at || task.deadline,
            target: {
                module: "tasks",
                taskId: task.id,
                projectId: task.project_id
            },
            dedupeKey: `task-deadline-${task.id}-${overdue ? "overdue" : "soon"}`
        });
    });

    return notifications;
}

function buildAdminProjectHealthNotifications(now, readOverrides = new Set()) {
    const notifications = [];
    const oneDay = 24 * 60 * 60 * 1000;

    adminState.projects.forEach((project) => {
        const endDate = new Date(project.end_date || project.deadline || "");
        if (Number.isNaN(endDate.getTime())) return;

        const delta = endDate.getTime() - now;
        const overdue = delta < 0 && !isCompletedStatus(project.status);
        const dueSoon = delta >= 0 && delta <= 2 * oneDay && !isCompletedStatus(project.status);
        if (!overdue && !dueSoon) return;

        const id = `project-health-${project.id}-${endDate.toISOString().slice(0, 10)}`;
        notifications.push({
            id,
            sourceId: project.id,
            category: "projects",
            level: overdue ? "error" : "warning",
            priority: overdue ? "high" : "medium",
            icon: overdue ? "fa-triangle-exclamation" : "fa-calendar-day",
            title: overdue ? "Project overdue" : "Project deadline approaching",
            message: overdue
                ? `${project.name || "Project"} is past its deadline and needs admin intervention.`
                : `${project.name || "Project"} is nearing its deadline and should be reviewed.`,
            relatedName: project.name || "Project",
            read: readOverrides.has(id),
            createdAt: project.updated_at || project.created_at || project.end_date,
            target: {
                module: "projects",
                projectId: project.id
            },
            dedupeKey: `project-health-${project.id}-${overdue ? "overdue" : "soon"}`
        });
    });

    return notifications;
}

function normalizeAdminNotification(notification, index, readOverrides = new Set()) {
    const text = getAdminNotificationText(notification).toLowerCase();
    if (!isAdminRelevantNotification(notification, text)) {
        return null;
    }

    const category = inferAdminNotificationCategory(notification, text);
    const level = inferAdminNotificationLevel(notification, text);
    const priority = inferAdminNotificationPriority(notification, text, level);
    const createdAt = notification.time || notification.created_at || notification.updated_at || new Date().toISOString();
    const relatedName = getAdminNotificationRelatedName(notification, category);
    const id = String(notification.id || `server-${category}-${index}-${safeSlug(notification.title || notification.message || "event")}`);
    const title = buildAdminNotificationTitle(notification, category, text);
    const message = buildAdminNotificationMessage(notification, category, text);
    const isRead = Boolean(notification.read) || readOverrides.has(id);

    return {
        id,
        sourceId: notification.id,
        category,
        level,
        priority,
        icon: getAdminNotificationIcon(level, category),
        title,
        message,
        relatedName,
        read: isRead,
        createdAt,
        type: notification?.type,
        invitationId: notification?.invitation_id,
        invitationStatus: notification?.status,
        invitationRole: notification?.role,
        target: buildAdminNotificationTarget(notification, category),
        dedupeKey: `${category}|${title}|${relatedName}|${formatDate(createdAt)}`
    };
}

function getAdminNotificationText(notification) {
    return [
        notification?.title,
        notification?.message,
        notification?.description,
        notification?.type,
        notification?.category,
        notification?.project_name,
        notification?.task_name,
        notification?.username,
        notification?.email,
        notification?.file_name
    ].filter(Boolean).join(" ");
}

function isAdminRelevantNotification(notification, normalizedText) {
    if (!normalizedText) return false;

    const recipientRole = String(notification?.role || notification?.recipient_role || notification?.user_role || "").toLowerCase();
    if (recipientRole && recipientRole !== "admin") return false;

    if (isPersonalAssignmentNotification(notification, normalizedText)) {
        return false;
    }

    if (!isAdminMonitoringNotification(notification, normalizedText)) {
        return false;
    }

    const excludedPhrases = [
        "password reset",
        "otp",
        "welcome back",
        "login successful",
        "signed in",
        "profile updated",
        "message received",
        "chat message",
        "commented on your task",
        "mentioned you",
        "personal reminder"
    ];

    if (excludedPhrases.some((phrase) => normalizedText.includes(phrase))) {
        return false;
    }

    return true;
}

function isPersonalAssignmentNotification(notification, normalizedText) {
    const title = String(notification?.title || "").toLowerCase();
    const personalPhrases = [
        "you were assigned task",
        "you were added to task",
        "you were assigned to project",
        "you were assigned to manage project"
    ];

    if (personalPhrases.some((phrase) => normalizedText.includes(phrase))) {
        return true;
    }

    if ((title === "new task assigned" || title === "task assignment updated" || title === "project assignment")
        && normalizedText.includes("you were")) {
        return true;
    }

    return false;
}

function isAdminMonitoringNotification(notification, normalizedText) {
    const task = findTaskForNotification(notification);
    const project = findProjectForNotification(notification, task);

    if (normalizedText.includes("project created")
        || normalizedText.includes("workspace invitation")
        || normalizedText.includes("invited to join the workspace")
        || normalizedText.includes("manager assignment")
        || normalizedText.includes("role updated")
        || normalizedText.includes("user registered")
        || normalizedText.includes("user created")
        || normalizedText.includes("file uploaded")
        || normalizedText.includes("project deleted")
        || normalizedText.includes("archived")
        || normalizedText.includes("activity log")
        || normalizedText.includes("system")
        || normalizedText.includes("deadline")
        || normalizedText.includes("overdue")
        || normalizedText.includes("failed")) {
        return true;
    }

    if (normalizedText.includes("task updated")) {
        return true;
    }

    if (normalizedText.includes("updated") && normalizedText.includes("completed")) {
        return true;
    }

    if (normalizedText.includes("project assigned")) {
        return true;
    }

    if (normalizedText.includes("task assigned")) {
        return isAdminOwnedTask(task) || isAdminOwnedProject(project);
    }

    if (normalizedText.includes("new task assigned") || normalizedText.includes("task assignment updated")) {
        return isAdminOwnedTask(task) || isAdminOwnedProject(project);
    }

    if (normalizedText.includes("project") || normalizedText.includes("task") || normalizedText.includes("user") || normalizedText.includes("file")) {
        return Boolean(task || project || notification?.user_id || notification?.email || notification?.file_id || notification?.file_name);
    }

    return false;
}

function findTaskForNotification(notification) {
    const taskId = notification?.task_id || notification?.sourceId || notification?.id;
    if (taskId) {
        const directTask = adminState.tasks.find((item) => String(item.id) === String(taskId));
        if (directTask) return directTask;
    }

    const taskName = String(notification?.task_name || notification?.title || "").trim().toLowerCase();
    const message = String(notification?.message || "").trim().toLowerCase();

    return adminState.tasks.find((item) => {
        const title = String(item.task_title || item.title || "").trim().toLowerCase();
        return title && (title === taskName || message.includes(`'${title}'`) || message.includes(`"${title}"`));
    }) || null;
}

function findProjectForNotification(notification, task = null) {
    const projectId = notification?.project_id || task?.project_id;
    if (projectId) {
        const directProject = adminState.projects.find((item) => String(item.id) === String(projectId));
        if (directProject) return directProject;
    }

    const projectName = String(notification?.project_name || "").trim().toLowerCase();
    if (projectName) {
        return adminState.projects.find((item) => String(item.name || item.project_name || "").trim().toLowerCase() === projectName) || null;
    }

    return null;
}

function isAdminOwnedTask(task) {
    const currentAdminEmail = String(sessionStorage.getItem("email") || "").trim().toLowerCase();
    if (!task || !currentAdminEmail) return false;

    return String(task.created_by || "").trim().toLowerCase() === currentAdminEmail
        || String(task.assigned_by || "").trim().toLowerCase() === currentAdminEmail;
}

function isAdminOwnedProject(project) {
    const currentAdminEmail = String(sessionStorage.getItem("email") || "").trim().toLowerCase();
    if (!project || !currentAdminEmail) return false;

    return String(project.created_by || "").trim().toLowerCase() === currentAdminEmail
        || String(project.owner_email || "").trim().toLowerCase() === currentAdminEmail;
}

function inferAdminNotificationCategory(notification, normalizedText) {
    const category = String(notification?.category || notification?.module || "").toLowerCase();
    if (["projects", "tasks", "users", "files", "system"].includes(category)) {
        return category;
    }

    if (normalizedText.includes("project") || notification?.project_id || notification?.project_name) return "projects";
    if (normalizedText.includes("task") || notification?.task_id || notification?.task_name) return "tasks";
    if (normalizedText.includes("user") || normalizedText.includes("manager") || normalizedText.includes("role") || notification?.user_id || notification?.username || notification?.email) return "users";
    if (normalizedText.includes("file") || normalizedText.includes("upload") || notification?.file_id || notification?.file_name) return "files";
    return "system";
}

function inferAdminNotificationLevel(notification, normalizedText) {
    const rawType = String(notification?.type || notification?.level || notification?.severity || "").toLowerCase();
    if (["success", "warning", "error", "info"].includes(rawType)) return rawType;

    if (normalizedText.includes("deleted") || normalizedText.includes("failed") || normalizedText.includes("overdue")) return "error";
    if (normalizedText.includes("deadline") || normalizedText.includes("archived") || normalizedText.includes("updated")) return "warning";
    if (normalizedText.includes("completed") || normalizedText.includes("created") || normalizedText.includes("uploaded")) return "success";
    return "info";
}

function inferAdminNotificationPriority(notification, normalizedText, level) {
    const rawPriority = String(notification?.priority || "").toLowerCase();
    if (["high", "medium", "low"].includes(rawPriority)) return rawPriority;

    if (level === "error" || normalizedText.includes("overdue") || normalizedText.includes("deleted") || normalizedText.includes("failed")) return "high";
    if (normalizedText.includes("assigned") || normalizedText.includes("updated") || normalizedText.includes("deadline")) return "medium";
    return "low";
}

function getAdminNotificationIcon(level, category) {
    if (level === "success") return "fa-circle-check";
    if (level === "warning") return "fa-triangle-exclamation";
    if (level === "error") return "fa-circle-exclamation";
    if (category === "system") return "fa-bell";
    if (category === "files") return "fa-file-arrow-up";
    if (category === "users") return "fa-user-shield";
    if (category === "tasks") return "fa-list-check";
    return "fa-circle-info";
}

function getAdminNotificationRelatedName(notification, category) {
    const direct = notification?.related_name
        || notification?.project_name
        || notification?.task_name
        || notification?.file_name
        || notification?.username
        || notification?.name;

    if (direct) return String(direct);

    if (category === "projects" && notification?.project_id) {
        const project = adminState.projects.find((item) => String(item.id) === String(notification.project_id));
        if (project?.name) return project.name;
    }

    if (category === "tasks" && notification?.task_id) {
        const task = adminState.tasks.find((item) => String(item.id) === String(notification.task_id));
        if (task?.title) return task.title;
    }

    if (category === "users" && notification?.email) {
        return notification.email;
    }

    return "";
}

function buildAdminNotificationTitle(notification, category, normalizedText) {
    if (notification?.title) return String(notification.title);

    if (category === "projects") {
        if (normalizedText.includes("deleted")) return "Project deleted";
        if (normalizedText.includes("archived")) return "Project archived";
        if (normalizedText.includes("assigned")) return "Project assigned to manager";
        if (normalizedText.includes("created")) return "Project created";
        if (normalizedText.includes("deadline")) return "Project deadline alert";
        return "Project update";
    }

    if (category === "tasks") {
        if (normalizedText.includes("completed")) return "Task completion update";
        if (normalizedText.includes("assigned")) return "Task assigned";
        if (normalizedText.includes("deadline") || normalizedText.includes("overdue")) return "Task deadline alert";
        return "Task update";
    }

    if (category === "users") {
        if (normalizedText.includes("workspace invitation")) return "Workspace Invitation";
        if (normalizedText.includes("role")) return "User role updated";
        if (normalizedText.includes("registered")) return "New user registration";
        if (normalizedText.includes("created")) return "User created";
        if (normalizedText.includes("manager")) return "Manager assignment updated";
        return "User update";
    }

    if (category === "files") {
        return normalizedText.includes("uploaded") ? "File uploaded" : "File activity";
    }

    return normalizedText.includes("activity") ? "Activity log update" : "System alert";
}

function buildAdminNotificationMessage(notification, category, normalizedText) {
    if (notification?.message) return String(notification.message);

    const related = getAdminNotificationRelatedName(notification, category);
    if (category === "projects") return related ? `${related} requires admin attention.` : "A project activity requires review.";
    if (category === "tasks") return related ? `${related} has a task-related update for admin review.` : "A task update requires review.";
    if (category === "users") return related ? `${related} has a user or role update.` : "A user activity requires review.";
    if (category === "files") return related ? `${related} was uploaded or updated.` : "A file activity requires review.";
    if (normalizedText.includes("failed")) return "A system action failed and should be reviewed.";
    return "An administrative activity was recorded.";
}

function buildAdminNotificationTarget(notification, category) {
    if (category === "projects") {
        return {
            module: "projects",
            projectId: notification?.project_id || notification?.id
        };
    }

    if (category === "tasks") {
        return {
            module: "tasks",
            taskId: notification?.task_id || notification?.id,
            projectId: notification?.project_id
        };
    }

    if (category === "users") {
        return {
            module: "users",
            userId: notification?.user_id || notification?.email || notification?.id
        };
    }

    if (category === "files") {
        return {
            module: "files",
            fileId: notification?.file_id || notification?.id
        };
    }

    return {
        module: "system"
    };
}

function notificationPriorityWeight(priority) {
    if (priority === "high") return 3;
    if (priority === "medium") return 2;
    return 1;
}

function safeSlug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "item";
}

function getFilteredAdminNotifications() {
    const activeFilter = ADMIN_NOTIFICATION_FILTERS.includes(adminState.notificationFilter)
        ? adminState.notificationFilter
        : "all";

    return adminState.notifications.filter((notification) => {
        if (activeFilter === "all") return true;
        if (activeFilter === "unread") return !notification.read;
        return notification.category === activeFilter;
    });
}

function renderAdminNotifications() {
    const list = document.getElementById("adminNotificationList");
    const summary = document.getElementById("adminNotificationSummary");
    if (!list) return;

    document.querySelectorAll(".notification-filter-chip").forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.filter === adminState.notificationFilter);
    });

    const filteredNotifications = getFilteredAdminNotifications();
    const unreadCount = adminState.notifications.filter((notification) => !notification.read).length;

    if (summary) {
        summary.textContent = unreadCount
            ? `${unreadCount} unread admin alert${unreadCount === 1 ? "" : "s"}`
            : "All admin alerts are caught up.";
    }

    if (!adminState.notifications.length) {
        list.innerHTML = `<div class="notification-empty">No admin notifications to show right now.</div>`;
        return;
    }

    if (!filteredNotifications.length) {
        list.innerHTML = `<div class="notification-empty">No notifications match the current filter.</div>`;
        return;
    }

    list.innerHTML = filteredNotifications.slice(0, 20).map((notification) => `
        <article class="notification-item ${notification.read ? "" : "unread"}" role="listitem">
            <span class="notification-item-icon ${escapeHtml(notification.level)}"><i class="fas ${escapeHtml(notification.icon)}"></i></span>
            <div class="notification-item-body">
                <div class="notification-item-copy">
                    <h4>${escapeHtml(notification.title || "Notification")}</h4>
                    <p>${escapeHtml(notification.message || "")}</p>
                </div>
                ${notification.relatedName ? `<div class="notification-item-target">${escapeHtml(notification.relatedName)}</div>` : ""}
                <span class="notification-item-time" title="${escapeHtml(formatAdminNotificationTime(notification.createdAt))}">${escapeHtml(formatAdminNotificationTimeAgo(notification.createdAt))}</span>
                <div class="notification-item-meta">
                    <span class="notification-state-pill ${notification.read ? "" : "unread"}">${notification.read ? "Read" : "Unread"}</span>
                    <span class="notification-category-pill">${escapeHtml(capitalize(notification.category))}</span>
                </div>
                <div class="notification-item-actions">
                    ${notification.read ? "" : `<button type="button" onclick="markAdminNotificationRead('${escapeHtml(notification.id)}', event)">Mark as read</button>`}
                    <button class="primary" type="button" onclick="openAdminNotificationTarget('${escapeHtml(notification.id)}', event)">Open ${escapeHtml(getAdminNotificationModuleLabel(notification.category))}</button>
                </div>
            </div>
        </article>
    `).join("");
}

function renderAdminNotificationsError() {
    const list = document.getElementById("adminNotificationList");
    if (!list) return;
    list.innerHTML = `<div class="notification-empty">Unable to load notifications.</div>`;
}

function setAdminNotificationFilter(filter) {
    if (!ADMIN_NOTIFICATION_FILTERS.includes(filter)) return;
    adminState.notificationFilter = filter;
    renderAdminNotifications();
}

async function markAdminNotificationRead(id, event) {

    if (event) event.stopPropagation();

    const token = sessionStorage.getItem("token");
    if (!id) return;

    try {

        const notification =
            adminState.notifications.find(
                (item) => String(item.id) === String(id)
            );

        if (notification?.sourceId && token) {
            await fetch(
                `${BASE_URL}/notifications/${encodeURIComponent(notification.sourceId)}/read`,
                {
                    method: "PUT",
                    headers: {
                        "Authorization": "Bearer " + token
                    }
                }
            );
        }

        // mark read
        adminState.notifications =
            adminState.notifications.map((notification) => (
                String(notification.id) === String(id)
                    ? { ...notification, read: true }
                    : notification
            ));

        rememberAdminNotificationRead(id);

        updateNotificationCount();
        renderAdminNotifications();

        // Auto remove from the open panel after 60 minutes.
        setTimeout(() => {

            adminState.notifications =
                adminState.notifications.filter(
                    (notification) =>
                        String(notification.id) !== String(id)
                );

            rememberAdminNotificationDismissed([id]);

            updateNotificationCount();
            renderAdminNotifications();

        }, 60 * 60 * 1000);

    } catch (error) {
        console.error(
            "Failed to mark notification read",
            error
        );
    }
}

async function markAllAdminNotificationsRead(event) {
    event.stopPropagation();
    const token = sessionStorage.getItem("token");

    try {
        if (token) {
            await fetch(`${BASE_URL}/notifications/read-all`, {
                method: "PUT",
                headers: {
                    "Authorization": "Bearer " + token
                }
            });
        }
        adminState.notifications = adminState.notifications.map((notification) => ({ ...notification, read: true }));
        adminState.notifications.forEach((notification) => rememberAdminNotificationRead(notification.id));
        await loadAdminNotifications();
    } catch (error) {
        console.error("Failed to mark notifications read", error);
    }
}

function clearAdminNotification(id, event) {
    if (event) event.stopPropagation();
    if (!id) return;

    adminState.notifications = adminState.notifications.filter((notification) => String(notification.id) !== String(id));
    rememberAdminNotificationDismissed([id]);
    updateNotificationCount();
    renderAdminNotifications();
}

function clearOldAdminNotifications(event) {
    if (event) event.stopPropagation();
    const threshold = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const removable = adminState.notifications
        .filter((notification) => notification.read || safeTime(notification.createdAt) < threshold)
        .map((notification) => notification.id);

    if (!removable.length) {
        showNotification("No old notifications to clear.", "info");
        return;
    }

    adminState.notifications = adminState.notifications.filter((notification) => !removable.includes(notification.id));
    rememberAdminNotificationDismissed(removable);
    updateNotificationCount();
    renderAdminNotifications();
    showNotification("Old notifications cleared.", "success");
}

function openAdminNotificationTarget(id, event) {
    if (event) event.stopPropagation();
    const notification = adminState.notifications.find((item) => String(item.id) === String(id));
    if (!notification) return;

    if (!notification.read) {
        markAdminNotificationRead(id);
    }

    const target = notification.target || {};
    closeAdminNotifications();

    if (target.module === "projects") {
        setActiveNav("projects");
        renderProjectsView();
        return;
    }

    if (target.module === "tasks") {
        if (target.projectId) {
            openAdminProjectWorkspace(target.projectId);
            return;
        }
        setActiveNav("tasks");
        renderTasksView();
        return;
    }

    if (target.module === "users") {
        setActiveNav("users");
        renderUsersView();
        return;
    }

    if (target.module === "files") {
        setActiveNav("files");
        renderFilesView();
        return;
    }

    goToActivityLog();
}

function getAdminNotificationModuleLabel(category) {
    if (category === "projects") return "project";
    if (category === "tasks") return "task";
    if (category === "users") return "user";
    if (category === "files") return "file";
    return "activity";
}

function formatAdminNotificationTime(value) {
    if (!value) return "Just now";
    const date = parseNotificationDate(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

function formatAdminNotificationTimeAgo(value) {
    if (!value) return "Just now";
    const date = parseNotificationDate(value);
    if (Number.isNaN(date.getTime())) return "Just now";

    const seconds = Math.max(Math.floor((Date.now() - date.getTime()) / 1000), 0);
    if (seconds < 60) return "Just now";

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

    return formatAdminNotificationTime(value);
}

function parseNotificationDate(value) {
    if (value instanceof Date) return value;
    const raw = String(value || "").trim();
    if (!raw) return new Date("");
    const normalized = /(?:z|[+\-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`;
    return new Date(normalized);
}

function getNotificationTimeValue(value) {
    const date = parseNotificationDate(value);
    return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function startAdminNotificationClock() {
    if (adminNotificationClock) return;
    adminNotificationClock = window.setInterval(() => {
        const list = document.getElementById("adminNotificationList");
        if (list && !list.querySelector(".notification-empty")) {
            renderAdminNotifications();
        }
    }, 30000);
}

function getAdminProjectDateRange(project) {
    const start = String(project?.start_date || "").trim();
    const end = String(project?.end_date || "").trim();

    if (start && end) return `${formatDate(start)} to ${formatDate(end)}`;
    if (start) return `Starts ${formatDate(start)}`;
    if (end) return `Ends ${formatDate(end)}`;
    return "No dates set";
}

function getAdminProjectCreatedDate(project) {
    return formatDate(project?.created_at || project?.start_date || project?.end_date) || "Not available";
}

function renderProjectCard(project) {
    const projectTasks = adminState.tasks.filter((task) => String(task.project_id) === String(project.id));
    const managerName = project.assigned_manager ? getAdminUserDisplayName(project.assigned_manager) : "Unassigned";
    const statusLabel = normalizeStatusLabel(project.status || "Planning");
    const statusClass = statusClassName(project.status || "Planning");

    return `
        <article class="admin-project-card manager-project-card" onclick="openAdminProjectWorkspace('${escapeHtml(project.id)}')">
            <div class="manager-project-card-body">
                <div class="project-card-main">
                    <div class="project-card-icon" aria-hidden="true">
                        <i class="fas fa-folder"></i>
                    </div>
                    <div class="project-card-copy admin-project-card-copy">
                        <h4 class="project-card-title">${escapeHtml(project.name || "Untitled Project")}</h4>
                        <div class="project-card-badges">
                            <span class="project-card-chip subtle">
                                <i class="fas fa-user-tie"></i>
                                ${projectTasks.length} ${projectTasks.length === 1 ? "Task" : "Tasks"}
                            </span>
                            <span class="project-card-chip status ${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>
                        </div>
                        <div class="project-card-meta">
                            <div class="project-card-meta-row">
                                <i class="far fa-envelope"></i>
                                <span>${escapeHtml(project.assigned_manager || project.owner_email || managerName)}</span>
                            </div>
                            <div class="project-card-meta-row">
                                <i class="far fa-calendar"></i>
                                <span>${escapeHtml(getAdminProjectDateRange(project))}</span>
                            </div>
                            <div class="project-card-meta-row status-row ${escapeHtml(statusClass)}">
                                <i class="fas fa-circle"></i>
                                <span>Status: ${escapeHtml(statusLabel)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="project-card-footer">
                    <span>Created: ${escapeHtml(getAdminProjectCreatedDate(project))}</span>
                    <div class="admin-project-card-actions" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
                        <button class="action-btn delete-btn" type="button" onclick="event.stopPropagation(); adminDeleteProject('${escapeHtml(project.id)}')">
                            <i class="fas fa-trash"></i>
                        </button>
                        <button class="project-card-cta" type="button" onclick="event.stopPropagation(); openAdminProjectWorkspace('${escapeHtml(project.id)}')">
                            <span>View Details</span>
                            <i class="fas fa-arrow-right"></i>
                        </button>
                    </div>
                </div>
            </div>
        </article>
    `;
}

function isCompletedStatus(status) {
    return String(status || "").toLowerCase() === "done" || String(status || "").toLowerCase() === "completed";
}

function isInProgressStatus(status) {
    const normalized = String(status || "").toLowerCase();
    return normalized === "in progress" || normalized === "progress" || normalized === "in review" || normalized === "review";
}

function isPendingStatus(status) {
    const normalized = String(status || "").toLowerCase();
    return normalized === "todo" || normalized === "pending";
}

function statusClassName(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "done" || normalized === "completed") {
        return "completed";
    }
    if (normalized === "in review" || normalized === "review") {
        return "review";
    }
    if (normalized === "in progress" || normalized === "progress") {
        return "in-progress";
    }
    if (normalized === "on hold" || normalized === "hold") {
        return "on-hold";
    }
    if (normalized === "planning" || normalized === "planned") {
        return "planning";
    }
    if (normalized === "pending" || normalized === "todo") {
        return normalized.replace(/\s+/g, "-");
    }
    return "pending";
}

function normalizeStatusLabel(status) {
    const normalized = String(status || "pending").trim().toLowerCase();
    if (normalized === "todo") {
        return "Pending";
    }
    if (normalized === "done") {
        return "Completed";
    }
    if (normalized === "progress") {
        return "In Progress";
    }
    if (normalized === "hold") {
        return "On Hold";
    }
    if (normalized === "planned") {
        return "Planning";
    }
    return normalized.split(" ").map(capitalize).join(" ");
}

function capitalize(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function compareDatesAsc(a, b) {
    const first = safeTime(a);
    const second = safeTime(b);
    return first - second;
}

function compareDatesDesc(a, b) {
    return compareDatesAsc(b, a);
}

function safeTime(value) {
    if (!value) {
        return Number.MAX_SAFE_INTEGER;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function formatDate(value) {
    if (!value) {
        return "No date";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).replace(/ /g, "-");
}

function isOverdue(value) {
    if (!value) {
        return false;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatSize(size) {
    if (!size) return "-";
    if (size < 1024) return size + " B";
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
}

document.addEventListener("taskflow:realtime-status", (event) => {
    if (event?.detail?.status === "connected") {
        loadAdminNotifications();
    }
});

document.addEventListener("taskflow:realtime", (event) => {
    const payload = event?.detail || {};
    if (payload.type === "admin.dashboard.updated" && payload.data) {
        adminState.dashboardStats = payload.data;
    }
});

window.initializeAdminDashboard = initializeAdminDashboard;
window.handleAdminSearch = handleAdminSearch;
window.goToDashboard = goToDashboard;
window.goToProjects = goToProjects;
window.goToTasks = goToTasks;
window.goToTeam = goToTeam;
window.goToUsers = goToUsers;
window.goToReports = goToReports;
window.goToActivityLog = goToActivityLog;
window.goToFiles = goToFiles;
window.goToProfile = goToProfile;
window.goToSettings = goToSettings;
window.saveAdminSettingsPreference = saveAdminSettingsPreference;
window.toggleAdminQuietNotifications = toggleAdminQuietNotifications;
window.applyAdminSettingsPreferences = applyAdminSettingsPreferences;
window.toggleAdminNotifications = toggleAdminNotifications;
window.setAdminNotificationFilter = setAdminNotificationFilter;
window.markAdminNotificationRead = markAdminNotificationRead;
window.markAllAdminNotificationsRead = markAllAdminNotificationsRead;
window.clearOldAdminNotifications = clearOldAdminNotifications;
window.clearAdminNotification = clearAdminNotification;
window.openAdminNotificationTarget = openAdminNotificationTarget;
window.exportActivityLog = exportActivityLog;
window.setAdminReportDateRange = setAdminReportDateRange;
window.clearAdminReportDateRange = clearAdminReportDateRange;
window.exportAdminReport = exportAdminReport;
window.toggleAdminReportList = toggleAdminReportList;
window.setAdminTaskProjectFilter = setAdminTaskProjectFilter;
window.setAdminTaskStatusFilter = setAdminTaskStatusFilter;
window.setAdminTaskPriorityFilter = setAdminTaskPriorityFilter;
window.setAdminTaskDueFilter = setAdminTaskDueFilter;
window.setAdminTaskSort = setAdminTaskSort;
window.setAdminTaskPage = setAdminTaskPage;
window.openAdminTaskDetail = openAdminTaskDetail;
window.closeAdminTaskDetail = closeAdminTaskDetail;
window.handleAdminTaskCardKeydown = handleAdminTaskCardKeydown;
window.enterAdminTaskEditMode = enterAdminTaskEditMode;
window.exitAdminTaskEditMode = exitAdminTaskEditMode;
window.saveAdminTaskEdit = saveAdminTaskEdit;
window.adminMarkTaskComplete = adminMarkTaskComplete;
window.adminUpdateTaskStatus = adminUpdateTaskStatus;
window.addAdminTaskComment = addAdminTaskComment;
window.downloadAdminTaskAttachment = downloadAdminTaskAttachment;
window.toggleAdminTeamProject = toggleAdminTeamProject;
window.setAdminTeamProjectFilter = setAdminTeamProjectFilter;
window.setAdminFileCategoryFilter = setAdminFileCategoryFilter;
window.setAdminFileSort = setAdminFileSort;
window.setAdminFilePage = setAdminFilePage;
window.resetAdminFileFilters = resetAdminFileFilters;
window.triggerAdminFileUpload = triggerAdminFileUpload;
window.handleAdminFileUpload = handleAdminFileUpload;
window.closeAdminFileUploadModal = closeAdminFileUploadModal;
window.handleAdminModalFileSelection = handleAdminModalFileSelection;
window.handleAdminFileProjectChange = handleAdminFileProjectChange;
window.toggleAdminFileAssigneeMenu = toggleAdminFileAssigneeMenu;
window.renderAdminFileAssigneeOptions = renderAdminFileAssigneeOptions;
window.removeAdminFileUploadAssignee = removeAdminFileUploadAssignee;
window.toggleAdminFileUploadAssignee = toggleAdminFileUploadAssignee;
window.updateAdminFileUploadMessageCount = updateAdminFileUploadMessageCount;
window.submitAdminAssignedFile = submitAdminAssignedFile;
window.adminDownloadFile = adminDownloadFile;
window.adminDeleteFile = adminDeleteFile;
window.adminDeleteTask = adminDeleteTask;
window.openAdminTaskModal = openAdminTaskModal;
window.closeAdminTaskModal = closeAdminTaskModal;
window.handleAdminTaskBackdrop = handleAdminTaskBackdrop;
window.updateAdminTaskField = updateAdminTaskField;
window.updateAdminTaskAttachments = updateAdminTaskAttachments;
window.toggleAdminTaskAssignee = toggleAdminTaskAssignee;
window.filterAdminTaskAssignees = filterAdminTaskAssignees;
window.submitAdminTask = submitAdminTask;
window.openAdminProjectModal = openAdminProjectModal;
window.closeAdminProjectModal = closeAdminProjectModal;
window.handleAdminProjectBackdrop = handleAdminProjectBackdrop;
window.updateAdminProjectField = updateAdminProjectField;
window.selectAdminProjectManager = selectAdminProjectManager;
window.filterAdminProjectManagers = filterAdminProjectManagers;
window.submitAdminProject = submitAdminProject;
window.assignAdminProjectManager = assignAdminProjectManager;
window.adminDeleteProject = adminDeleteProject;
window.openAdminProjectWorkspace = openAdminProjectWorkspace;
window.setAdminUserPage = setAdminUserPage;
window.setAdminUserRoleFilter = setAdminUserRoleFilter;
window.resetAdminUserFilters = resetAdminUserFilters;
window.openInviteModal = openInviteModal;
window.closeInviteModal = closeInviteModal;
window.handleInviteBackdrop = handleInviteBackdrop;
window.updateInviteField = updateInviteField;
window.sendInvitation = sendInvitation;
window.openAddUserModal = openAddUserModal;
window.closeAddUserModal = closeAddUserModal;
window.handleAddUserBackdrop = handleAddUserBackdrop;
window.updateAddUserField = updateAddUserField;
window.submitAddUser = submitAddUser;
window.changeUserRole = changeUserRole;
window.deleteUser = deleteUser;

