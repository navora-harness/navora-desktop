<template>
  <Teleport to="body"><div ref="composerMenuBoundary" class="composer-menu-boundary" /></Teleport>
  <div
    class="shell main-shell"
    :data-chat-id="activeId||undefined"
    :style="[sidebarStyle,{'--workspace-caption-reserve':'12px'}]"
    :class="{
      'mobile-layout': isMobileLayout,
      'remote-web': isWebRemote(),
      'sidebar-open': isMobileLayout && mobileSidebarOpen,
      'sidebar-collapsed': allSidebarHidden && !settingsOpen && !creatorKind,
      'sidebar-floating': sidebarFloating && !settingsOpen && !creatorKind,
      'sidebar-resizing': sidebarResizing,
      'docs-open':docsOpen,
      frameless: showDesktopChrome,
      'platform-mac': windowPlatform === 'darwin',
    }"
  >
    <header v-if="showDesktopChrome && !isMobileLayout" class="window-titlebar" aria-label="Navora 窗口标题栏">
      <div class="window-titlebar-brand" aria-hidden="true">
        <img src="/app-icon.png" alt="" draggable="false" />
        <span>Navora</span>
      </div>
      <ApplicationMenuBar ref="appMenu" :command-state="applicationCommandState" :context-key="activeId || ''" :app-version="applicationVersion" :shortcuts-active="!settingsOpen&&!docsOpen&&!creatorKind" :capture-target="captureApplicationTarget" :restore-target="restoreApplicationTarget" @beforeopen="refreshApplicationTarget" @command="executeApplicationCommand" @error="onPanelNotify" />
      <button type="button" class="ui-icon-button window-sidebar-toggle" :disabled="!!settingsOpen||!!creatorKind||sidebarFloatingDisabled" :aria-label="sidebarPresentationLabel" :title="sidebarPresentationLabel" :aria-pressed="sidebarFloatingDisabled||sidebarPresentationMode==='fixed'" @click="toggleSidebarPresentation"><SidebarPresentationIcon :floating="!sidebarFloatingDisabled&&sidebarPresentationMode==='floating'" /></button>
      <div class="window-titlebar-drag" aria-hidden="true" />
    </header>
    <Transition name="sidebar-backdrop">
    <div
      v-if="isMobileLayout && mobileSidebarOpen"
      class="sidebar-backdrop"
      aria-hidden="true"
      @click="closeMobileSidebar"
    />
    </Transition>
      <nav class="activity-rail" aria-label="侧栏导航" @contextmenu.prevent.stop="railContextMenu?.show($event)" @keydown="onRailContextKey">
        <div class="activity-rail-sections">
          <div v-if="!showDesktopChrome || isMobileLayout" class="rail-brand" :class="{ 'app-drag': showDesktopChrome }" title="Navora">
            <img src="/app-icon.png" alt="Navora" draggable="false" />
          </div>
          <SidebarNavigation :panels="sidebarPanels" :active="sidebarRail.active" :inactive="docsOpen || settingsOpen || !!creatorKind" @activate="toggleSidebarGroup" />
        </div>
        <div class="sidebar-foot">
        <div class="sidebar-foot-actions">
          <button v-if="!showDesktopChrome || isMobileLayout" type="button" class="sidebar-icon-btn" title="应用菜单" aria-label="应用菜单" @mousedown.prevent @click="appMenu?.openMenu('file')"><AppIcon icon="bars" /></button>
          <button type="button" class="sidebar-icon-btn sidebar-docs-btn" :class="{selected:docsOpen}" title="使用文档" aria-label="使用文档" :aria-current="docsOpen?'page':undefined" :aria-pressed="docsOpen" @click="onMoreDocs()"><AppIcon icon="book" /></button>
          <button v-if="isWebRemote()" type="button" class="sidebar-icon-btn" title="远程窗口" aria-label="远程窗口" @click="openRemoteWindows"><AppIcon icon="browser" /></button>
          <div class="sidebar-foot-end">
            <button
              type="button"
              class="sidebar-icon-btn sidebar-settings-btn"
              :class="{ selected: settingsOpen && !docsOpen }"
              :title="settingsOpen ? '返回上一页（Alt ←）' : '设置'"
              :aria-label="settingsOpen ? '返回上一页' : '设置'"
              :aria-pressed="settingsOpen && !docsOpen"
              @click="toggleSettings"
            >
              <AppIcon icon="gear" />
            </button>
          </div>
        </div>
      </div>
      </nav>
    <div class="content-surface">
    <aside ref="sidebarElement" class="sidebar" :data-browser-chrome-overlay="sidebarFloating&&!settingsOpen&&!creatorKind&&!allSidebarHidden?'sidebar':undefined" :aria-label="sidebarFloating&&!settingsOpen&&!creatorKind?'悬浮侧栏':'侧栏'">
      <div class="sidebar-content-stack">
      <Transition name="sidebar-flip">
      <div v-show="(!settingsOpen && !creatorKind) || isMobileLayout" class="sidebar-chat-face">
      <SidebarDock :active="sidebarRail.active" :panels="sidebarPanels" :floating="sidebarFloating" :pinned="sidebarFloatingDisabled || sidebarPresentationMode==='fixed'" :pin-disabled="sidebarFloatingDisabled" :pin-disabled-reason="sidebarFloatingDisabledReason" :show-pin="!showDesktopChrome||isMobileLayout" @pin="toggleSidebarPin" @close="closeSidebar">
        <template #chats="slot">
      <Teleport :to="slot.headerTarget" defer><button v-show="slot.active" type="button" class="chat-toolbar-icon-btn chat-batch-trigger" :title="chatBatchMode ? '取消批量操作' : '批量管理对话'" :aria-label="chatBatchMode ? '取消批量操作' : '批量操作'" :aria-pressed="chatBatchMode" @click="chatBatchMode ? exitChatBatchMode() : enterChatBatchMode()"><AppIcon :icon="chatBatchMode ? 'xmark' : 'list-check'" /></button></Teleport>
      <div class="chat-list-actions" role="group" aria-label="对话操作">
        <button type="button" class="chat-new-action" title="开启新对话（Ctrl/⌘ N）" aria-label="开启新对话" @click="createChat"><AppIcon icon="pen-to-square" /><span>新对话</span><kbd>{{ windowPlatform==='darwin'?'⌘ N':'Ctrl N' }}</kbd></button>
        <button type="button" class="chat-search-action" title="搜索对话（Ctrl/⌘ K）" aria-label="搜索对话" @click="openChatSearch"><AppIcon icon="magnifying-glass" /></button>
      </div>
      <div v-if="chatBatchMode" class="chat-toolbar">
        <Transition name="toolbar-swap" mode="out-in">
          <div key="batch" class="chat-toolbar-row">
            <v-btn
              size="small"
              variant="tonal"
              class="batch-select-btn"
              @click="toggleBatchSelectAll"
            >
              {{ batchAllSelected ? '取消全选' : '全选' }}
            </v-btn>
            <span class="chat-batch-count" role="status" aria-live="polite">已选 {{ batchSelectedCount }}</span>
          </div>
        </Transition>
      </div>
      <Transition name="sidebar-pane">
      <div v-show="true" class="chat-list" :class="{ 'batch-mode': chatBatchMode }">
        <section v-for="sec in visibleChatListSections" :key="sec.key" class="chat-date-group" :aria-label="sec.label">
          <div class="chat-date-label" role="heading" aria-level="3"><span>{{ sec.label }}</span></div>
          <template v-for="c in sec.items" :key="c.id" v-memo="[c, chats, activeId, chatBatchMode, batchSelectedIds, isMobileLayout, chatSwipeOpenId, chatSwipeDragId, chatSwipeOffset, chatSwipeLockedH, chatMoreOpenId, renamingChatId, renameDraft, chatStatusById, pendingAsks, windowCounts, subchatsByParent, runningChats, exportingChat, Math.floor(nowTick / 60000)]">
            <div
              class="chat-item"
              :class="{
                active: !chatBatchMode && c.id === activeId,
                pinned: Boolean(c.pinned),
                'swipe-open': !chatBatchMode && chatSwipeOpenId === c.id,
                swiping: !chatBatchMode && chatSwipeLockedH && chatSwipeDragId === c.id,
                'menu-open': !chatBatchMode && chatMoreOpenId === c.id,
                renaming: !chatBatchMode && renamingChatId === c.id,
                'batch-selected': chatBatchMode && batchSelectedIds.has(c.id),
              }"
            >
            <button
              v-if="!chatBatchMode"
              type="button"
              class="chat-swipe-del"
              title="删除 Chat"
              tabindex="-1"
              @click.stop="askDeleteChat(c)"
            >
              <AppIcon icon="trash" />
              <span>删除</span>
            </button>
            <div
              class="chat-item-track"
              :style="chatBatchMode ? undefined : chatSwipeTrackStyle(c.id)"
              @touchstart.passive="chatBatchMode ? undefined : onChatTouchStart($event, c.id)"
              @touchmove="chatBatchMode ? undefined : onChatTouchMove($event, c.id)"
              @touchend="chatBatchMode ? undefined : onChatTouchEnd(c.id)"
              @touchcancel="chatBatchMode ? undefined : onChatTouchEnd(c.id)"
              @contextmenu="onChatItemContext($event, c)"
              @keydown="onChatItemContextKey($event,c)"
            >
              <button type="button" class="chat-item-main" :aria-pressed="chatBatchMode ? batchSelectedIds.has(c.id) : undefined" @click="onChatItemActivate(c.id)">
                <Transition name="batch-check">
                  <span
                    v-if="chatBatchMode"
                    class="chat-batch-check"
                    :class="{ on: batchSelectedIds.has(c.id) }"
                    aria-hidden="true"
                  >
                    <AppIcon
                      :icon="batchSelectedIds.has(c.id) ? 'circle-check' : 'circle'"
                    />
                  </span>
                </Transition>
                <div class="chat-item-body">
                  <div class="chat-item-title">
                    <AppIcon
                      v-if="c.pinned"
                      icon="thumbtack"
                      class="chat-pin-icon"
                      title="已置顶"
                    />
                    <input
                      v-if="renamingChatId === c.id"
                      :ref="(el) => setRenameInputRef(c.id, el)"
                      v-model="renameDraft"
                      class="chat-item-title-input"
                      maxlength="80"
                      aria-label="修改对话标题"
                      @click.stop
                      @focus="onRenameInputFocus"
                      @keydown.enter.prevent="commitRenameChat"
                      @keydown.escape.prevent="cancelRenameChat"
                      @blur="onRenameInputBlur"
                    />
                    <span
                      v-else
                      class="chat-item-title-text"
                      :title="`${displayChatTitle(c.title)} · ${formatRelative(c.updatedAt)}${windowCounts[c.id] ? ` · ${windowCounts[c.id]} 个窗口` : ''}${subchatCountOf(c.id) ? ` · ${subchatCountOf(c.id)} 个子对话` : ''}`"
                      >{{ displayChatTitle(c.title) }}</span
                    >
                    <button
                      v-if="isMobileLayout && !chatBatchMode && renamingChatId !== c.id && chatStatusById[c.id]"
                      type="button"
                      class="chat-status-icon"
                      :class="chatStatusById[c.id].tone"
                      :title="chatStatusById[c.id].title"
                      :aria-label="chatStatusById[c.id].title"
                      @click.stop="onChatStatusClick(c.id)"
                    >
                      <StatusIcon :kind="chatStatusById[c.id].tone" />
                    </button>
                  </div>
                  <div class="chat-item-meta">
                    <span class="chat-item-time">{{ formatRelative(c.updatedAt) }}</span>
                    <span class="chat-item-meta-end">
                      <span
                        v-if="!chatBatchMode && (pendingAskForSidebar(c.id)||pendingQuestionnaireForSidebar(c.id))"
                        class="badge ask-pending-badge"
                      >
                        {{
                          pendingQuestionnaireForSidebar(c.id)
                            ? (pendingQuestionnaireForSidebar(c.id)!.chatId===c.id?'问卷待填写':'子任务问卷')
                            : pendingAskBadge(pendingAskForSidebar(c.id)!.chatId) ||
                              (pendingAskForSidebar(c.id)!.chatId !== c.id ? '子任务' : '询问/决策')
                        }}
                      </span>
                      <span
                        v-if="
                          !chatBatchMode &&
                          (windowCounts[c.id] || subchatCountOf(c.id))
                        "
                        class="chat-item-stats"
                      >
                        <span
                          v-if="windowCounts[c.id]"
                          class="chat-stat"
                          :title="`${windowCounts[c.id]} 个窗口`"
                          :aria-label="`${windowCounts[c.id]} 个窗口`"
                        >
                          <AppIcon icon="browser" />
                          <span class="chat-stat-num">{{ windowCounts[c.id] }}</span>
                        </span>
                        <span
                          v-if="subchatCountOf(c.id)"
                          class="chat-stat chat-stat-sub"
                          :title="`${subchatCountOf(c.id)} 个子对话`"
                          :aria-label="`${subchatCountOf(c.id)} 个子对话`"
                        >
                          <AppIcon icon="sitemap" />
                          <span class="chat-stat-num">{{ subchatCountOf(c.id) }}</span>
                        </span>
                      </span>
                    </span>
                  </div>
                </div>
              </button>

              <div v-if="!chatBatchMode" class="chat-item-trail" :class="{ 'mobile-more-only': isMobileLayout }">
                <div v-if="!isMobileLayout" class="chat-item-trail-face">
                  <button
                    v-if="chatStatusById[c.id]"
                    type="button"
                    class="chat-status-icon"
                    :class="chatStatusById[c.id].tone"
                    :title="chatStatusById[c.id].title"
                    :aria-label="chatStatusById[c.id].title"
                    @click.stop="onChatStatusClick(c.id)"
                  >
                    <StatusIcon :kind="chatStatusById[c.id].tone" />
                  </button>
                </div>
                <div class="chat-item-trail-more">
                  <button type="button" class="chat-more-btn" title="更多" aria-label="更多" aria-haspopup="menu" :aria-expanded="chatMoreOpenId===c.id" @click.stop="showNativeChatRowMenu(c,$event)"><AppIcon icon="ellipsis" /></button>
                </div>
              </div>
            </div>
            </div>


          </template>
        </section>
        <button
          v-if="chatListRemainingCount > 0 && !chatBatchMode"
          type="button"
          class="chat-list-load-more"
          @click="loadMoreChats"
        >
          显示更早的对话 · 还有 {{ chatListRemainingCount }} 个
        </button>
      </div>
      </Transition>

        <div v-if="chatBatchMode" key="batch-actions" class="batch-list-footer">
          <v-btn
            size="small"
            variant="tonal"
            class="batch-pin-btn"
            :disabled="!batchSelectedCount || batchPinning"
            :loading="batchPinning"
            @click="batchPinSelected"
          >
            <AppIcon icon="thumbtack" class="batch-pin-icon" />
            {{ batchSelectionAllPinned ? '取消置顶' : '置顶'
            }}
          </v-btn>
          <v-btn
            size="small"
            color="error"
            variant="flat"
            class="batch-delete-btn"
            :disabled="!batchSelectedCount"
            @click="askBatchDeleteChats"
          >
            <AppIcon icon="trash" class="batch-delete-icon" />删除
          </v-btn>
        </div>
        </template>
        <template #workspace="slot">
          <GlobalResourcesPanel v-if="loadedResourcePanels.has('workspace')" :active="slot.active" kind="files" :chats="chats" :active-chat-id="activeId || ''" :is-remote="isWebRemote()" :owner-label="treeOwnerLabel" :dnd-mime="DND_MIME" @notify="onPanelNotify" @preview="openFilePreview($event.path,$event.chatId)" @browse="browseFiles" @select-chat="openResourceChat" />
        </template>
        <template #browser="slot">
          <GlobalResourcesPanel v-if="loadedResourcePanels.has('browser')" :active="slot.active" kind="browser" :chats="chats" :active-chat-id="activeId || ''" :is-remote="isWebRemote()" :owner-label="treeOwnerLabel" :dnd-mime="DND_MIME" @notify="onPanelNotify" @add-ref="addRef" @ask-close-session="askCloseSession" @remote-view="openRemoteWindow" @select-chat="openResourceChat" />
        </template>
        <template #plugins><div id="plugins-sidebar-nav" class="plugins-sidebar-host" /></template>
      </SidebarDock>

      </div>
      </Transition>
      <Transition name="sidebar-flip">
        <div v-show="(settingsOpen || creatorKind) && !isMobileLayout" class="sidebar-settings-face">
          <div class="settings-sidebar-heading">{{ creatorKind ? (creatorKind === 'plugin' ? '插件创建器' : '技能创建器') : '设置' }}</div>
          <div v-show="settingsOpen" id="settings-sidebar-nav" />
          <div v-show="creatorKind" id="creator-sidebar-nav" />
        </div>
      </Transition>
      </div>

      <div v-if="!isMobileLayout && !sidebarFloating && (!allSidebarHidden || settingsOpen || creatorKind)" class="sidebar-divider vertical" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" :aria-valuenow="sidebarLayout.width" aria-valuemin="292" :aria-valuemax="sidebarWidthMaximum" tabindex="0" @pointerdown="beginSidebarResize($event, 'width')" @keydown="sidebarResizeKey($event, 'width')" />
    </aside>

    <main ref="mainElement" class="main" :data-workspace-expansion="workspaceExpansionReason||'manual-or-split'" :data-workspace-width="fileWorkspaceMainWidth" :class="{ 'docs-workspace-open':docsOpen, 'resource-card-docked': resourceOpen && !resourceOverlay && !settingsOpen && !creatorKind && !fileManagerActive && !pluginWorkspaceActive && !browserWorkspaceActive, 'file-workspace-open': fileWorkspaceVisible, 'workspace-single':fileWorkspaceVisible && (browserExpanded || fileWorkspaceOverlay) && !workspaceConversationActive,'workspace-chat-active':fileWorkspaceVisible && browserExpanded && workspaceConversationActive }" :style="{ '--preview-width': `${previewWidth}px`, '--file-workspace-reserve':`${fileWorkspaceReserve}px` }">
      <div v-if="showDesktopChrome && ((!settingsOpen && !creatorKind) || isMobileLayout)" class="win-drag-main" aria-hidden="true" />
      <header v-if="isMobileLayout && !settingsOpen && !creatorKind" class="mobile-topbar" :class="{'plugin-mobile-topbar':pluginWorkspaceActive}">
        <button
          v-if="active?.kind === 'sub' && active.parentChatId"
          type="button"
          class="mobile-topbar-btn"
          aria-label="返回"
          @click="selectChat(active.parentChatId)"
        >
          <AppIcon icon="arrow-left" />
        </button>
        <button
          v-else
          type="button"
          class="mobile-topbar-btn"
          aria-label="打开菜单"
          @click="openMobileSidebar"
        >
          <AppIcon icon="bars" />
        </button>
        <div v-if="!browserWorkspaceActive && !pluginWorkspaceActive" class="mobile-topbar-center">
          <span v-if="isWebRemote()" class="remote-badge">远程</span>
          <span v-if="active?.kind === 'sub'" class="remote-badge">子任务</span>
          <div class="mobile-topbar-titles">
            <span
              class="mobile-topbar-title"
              :class="{ 'is-sub': active?.kind === 'sub' }"
              :title="
                active?.kind === 'sub'
                  ? subchatTitleTooltip(active)
                  : displayChatTitle(active?.title)
              "
              >{{
                active?.kind === 'sub'
                  ? displaySubchatTitle(active)
                  : displayChatTitle(active?.title)
              }}</span
            >
          </div>
        </div>
        <div v-if="!pluginWorkspaceActive && !browserWorkspaceActive" class="mobile-topbar-actions">
          <button
            v-if="isWebRemote()"
            type="button"
            class="mobile-topbar-btn"
            aria-label="远程窗口"
            @click="openRemoteWindows"
          >
            <AppIcon icon="browser" />
          </button>
          <BrowserDownloadsMenu
            :chat-id="activeId"
            only-active-chat
            location="bottom end"
            btn-class="mobile-topbar-btn"
          />
          <button
            type="button"
            class="mobile-topbar-btn"
            aria-label="设置"
            @click="openSettings()"
          >
            <AppIcon icon="gear" />
          </button>
        </div>
      </header>
      <DocsPage ref="docsWorkspace" v-if="docsOpen" class="docs-workspace" embedded :mobile="isMobileLayout" :initial-chapter="docsChapter" :initial-section="docsSection" @close="closeDocsPage" @navigate="navigateDocs" />
      <CreatorWorkspace ref="creatorWorkspace" v-show="!docsOpen" v-if="creatorKind" :key="creatorKind" :kind="creatorKind" :navigation-target="isMobileLayout ? undefined : '#creator-sidebar-nav'" @close="closeCreator" @trial="openCreatorTrial" @notify="onPanelNotify" />
      <SettingsPage ref="settingsWorkspace" v-show="!docsOpen" v-if="settingsOpen && !creatorKind" class="settings-workspace" :initial-tab="settingsTab" :return-label="settingsReturnLabel" :focus-on-entry="browserSettingsFocusPending" @entry-focused="browserSettingsFocusPending = false" @navigate="settingsTab = $event" embedded :mobile="isMobileLayout" :navigation-target="isMobileLayout ? undefined : '#settings-sidebar-nav'" @close="completeSettingsReturn" @create="openCreator" />
      <template v-if="!creatorKind">
      <FileManager ref="fileManagerWorkspace" v-if="fileManagerMounted" v-show="fileManagerActive" :active="fileManagerActive" :class="{'is-active':fileManagerActive}" :chat-id="fileManagerOwner?.id || ''" :title="fileManagerOwner?.title || ''" :directory="fileManagerDirectory" @browse="fileManagerDirectory=$event" @preview="openFilePreview" @back="activateSidebar('chats',false)" @notify="onPanelNotify" />
      <PluginWorkspace ref="pluginsWorkspace" v-if="pluginWorkspaceMounted" v-show="pluginWorkspaceActive" :active="pluginWorkspaceActive" :class="{'is-active':pluginWorkspaceActive}" sidebar-target="#plugins-sidebar-nav" @back="activateSidebar('chats',false)" @create="openCreator('plugin')" @selected="closeMobileSidebar" @notify="onPanelNotify" />
      <div v-show="!docsOpen && !settingsOpen && !fileManagerActive && !pluginWorkspaceActive && !browserWorkspaceActive" id="conversation-panel" class="conversation-content" :inert="docsOpen || settingsOpen || fileManagerActive || pluginWorkspaceActive || browserWorkspaceActive || (fileWorkspaceVisible && browserExpanded && !workspaceConversationActive)">
      <template v-if="active">
        <header
          class="main-top conversation-title-header"
          :class="{ compact: isMobileLayout }"
          style="padding-right:var(--workspace-control-inset,12px)"
        >
          <div v-if="!isMobileLayout" class="main-top-text">
            <div v-if="active.kind === 'sub'" class="subchat-banner">
              <button
                type="button"
                class="subchat-back"
                :disabled="!active.parentChatId"
                @click="active.parentChatId && selectChat(active.parentChatId)"
              >
                <AppIcon icon="arrow-left" />
                返回
              </button>
              <span class="subchat-banner-label">子任务</span>
            </div>
            <h1
              class="main-title"
              :class="{ 'is-sub': active.kind === 'sub' }"
              :title="
                active.kind === 'sub'
                  ? subchatTitleTooltip(active)
                  : displayChatTitle(active.title)
              "
            >
              {{
                active.kind === 'sub'
                  ? displaySubchatTitle(active)
                  : displayChatTitle(active.title)
              }}
            </h1>
          </div>
          <div v-if="agentRunning" class="agent-live">
            <StatusIcon kind="running" :spin="false" />
            <span class="agent-live-text" :title="phaseLabel">{{ phase === 'awaiting_permission' || phase === 'awaiting_user' || phase === 'awaiting_skill_review' ? '等待确认' : phase === 'calling_tool' ? '执行中' : '生成中' }}</span>
            <span class="agent-elapsed">{{ elapsedLabel }}</span>
            <button type="button" class="quick-stop-btn" title="停止任务" aria-label="停止任务" @click="stopAgent"><StatusIcon kind="stopped" />停止</button>
          </div>
          <Teleport :to="workspaceToolsTarget||'body'" :disabled="!workspaceHeaderActive||!workspaceConversationActive||!workspaceToolsTarget"><div class="workspace-chat-tools" @keydown="onWorkspaceChatToolKey"><button type="button" class="ui-icon-button" title="在当前聊天中查找（Ctrl/⌘ F）" aria-label="在当前聊天中查找" @click="openConversationFind"><AppIcon icon="magnifying-glass"/></button><button v-if="subchatSignals.total" type="button" class="ui-icon-button subchat-workspace-trigger" :title="`子对话 ${subchatSignals.total} 个${subchatSignals.pending?`，${subchatSignals.pending} 项需要处理`:''}${subchatSignals.unread?`，${subchatSignals.unread} 个有未读内容`:''}`" :aria-label="`打开子对话列表，${subchatSignals.total} 个子对话${subchatSignals.pending?`，${subchatSignals.pending} 项需要处理`:''}${subchatSignals.unread?`，${subchatSignals.unread} 个未读`:''}`" @click="openSubchatList"><AppIcon icon="robot" /><span v-if="subchatSignals.pending" class="subchat-pending-count">{{subchatSignals.pending}}</span></button><ChatResourcesMenu ref="browserResources" class="conversation-title-actions" context="chat" :running="agentRunning" @context-action="onPageAction" @new-browser-tab="openBrowserTab" @new-chat="createChat" @search="openConversationFind" @delete="active && askDeleteChat(active)" @stop="stopAgent" :chat-id="activeId || ''" :tree="tree" :is-remote="isWebRemote()" :annotation-entries="chatAnnotationEntries" :annotation-busy-key="annotationCardBusy" :annotation-error="chatAnnotationError" @annotation-action="annotationCardAction" @refresh-annotations="refreshChatAnnotations" :open="resourceOpen" :updated="resourceUpdated" :update-count="resourceUpdateCount" :pinned="!!active?.pinned" :can-export="!!active?.messages.length" :exporting="exportingChat" @rename="renameCurrentChat" @pin="active && toggleChatPinned(active)" @export="exportActiveChat" @notify="onPanelNotify" @toggle-resources="toggleResources" @show-browser="showResources('browser')" /></div></Teleport>
          <span v-if="!fileWorkspaceVisible" class="workspace-controls-divider" aria-hidden="true" />
          <WorkspaceLauncher v-if="!fileWorkspaceVisible" :count="fileTabsState.tabs.length" :open="false" :disabled="!activeId" @activate="toggleRightSidebar" />
        </header>

        <ConversationFind ref="conversationFind" :active="conversationIsVisible" :chat-id="activeId||''" :messages="active.messages" :live-text="liveAnswerText" :root="msgBox" :display-text="message => message.role==='log' ? logFullText(message) : displayMessageContent(message)" :locate="locateFindMessage" @open="conversationFindOpen=$event;restoreFindExpansion($event)" @navigate="revealFindConversation" />
        <div class="messages-wrap">
          <section
            ref="msgBox"
            class="messages"
            data-ctx-menu="messages"
            @scroll="onMessagesScroll"
            @scrollend="onMessagesScrollEnd"
            @wheel.passive="onMessagesScrollInput"
            @touchmove.passive="onMessagesScrollInput"
            @pointerdown="onMessagesScrollInput"
            @keydown="onMessagesScrollInput"
            @click="onMessagesClick"
            @contextmenu.prevent="onMessagesContext"
            @keydown.capture="onMessageContextKey"
            tabindex="0"
          >
            <div v-if="!messageBlocks.length && !agentRunning" class="msg-empty">
              <div class="msg-empty-title">开始一段对话</div>
              <p class="msg-empty-desc">直接提问，或让 Navora 帮你浏览、整理和完成任务。</p>
            </div>

            <div v-if="chatAnnotationError" class="annotation-chat-status" role="status">{{chatAnnotationError}} <button type="button" class="ui-button" @click="refreshChatAnnotations">重试</button></div>
            <div v-if="chatAnnotationRecovery.issues.length" class="annotation-chat-status" role="status">{{chatAnnotationRecovery.issues.length}} 个异常批注草稿已隔离保留。</div>
            <!-- Sidebar and composer changes must not rebuild unchanged transcript rows. -->
            <template v-for="block in messageBlocks" :key="block.key" v-memo="[block, activeId, agentRunning, processHeaders, expandedProcesses, expandedTools, expandedLogs, findToolReveal, logOverflowById, toolMediaSrc, chats, showReadPages, readPagesPanelOpen, readPagesPanelFromId, copiedMessageId, replyFilesById, Math.floor(nowTick / 60000)]">
              <ConversationProcessToggle v-if="processHeaders.has(block.key)" :group="processHeaders.get(block.key)!" :open="!!expandedProcesses[processHeaders.get(block.key)!.key]" @toggle="toggleProcess(processHeaders.get(block.key)!.key)"/>
              <div
                v-if="block.type === 'log'"
                v-show="!processMessageHidden(block.key)"
                class="msg log"
                :data-msg-id="block.message.id" tabindex="0"
                :class="logToneClass(block.message)"
              >
                <div class="msg-row">
                  <div class="msg-avatar log" aria-hidden="true">
                    <StatusIcon :kind="block.message.meta?.kind === 'agent_error' ? 'error' : block.message.meta?.kind === 'agent_stop' ? 'stopped' : 'success'" />
                  </div>
                  <div class="msg-main">
                    <div class="msg-role">
                      <span>日志</span>
                      <span class="msg-time" :title="formatTime(block.message.createdAt)">{{
                        formatRelative(block.message.createdAt)
                      }}</span>
                    </div>
                    <div
                      class="log-card activity-group"
                      :class="{
                        open: isLogExpanded(block.message.id),
                        expandable: logCanExpand(block.message),
                      }"
                    >
                      <div
                        class="log-card-head activity-trigger"
                        role="button"
                        :tabindex="logCanExpand(block.message) ? 0 : -1"
                        :aria-expanded="
                          logCanExpand(block.message) ? isLogExpanded(block.message.id) : undefined
                        "
                        @click="onLogCardActivate(block.message, $event)"
                        @keydown.enter.prevent="onLogCardActivate(block.message, $event)"
                        @keydown.space.prevent="onLogCardActivate(block.message, $event)"
                      >
                        <StatusIcon :kind="logToneClass(block.message) === 'tone-error' ? 'error' : 'log'" />
                        <span class="log-kind-chip">{{ logKindText(block.message) }}</span>
                        <span
                          class="log-card-text"
                          :class="{ clamped: !isLogExpanded(block.message.id) }"
                          :ref="(el) => measureLogOverflow(block.message.id, el, block.message)"
                          >{{ logFullText(block.message) }}</span
                        >
                        <span v-if="logCanExpand(block.message)" class="log-card-chevron">
                          <AppIcon
                            icon="chevron-right"
                          />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="block.type === 'tool'" v-show="!processMessageHidden(block.key)" class="msg tool transcript-tool" :data-msg-id="block.message.id" tabindex="0">
                <SubchatLink v-if="isSubchatSpawnTool(block.message)" :chat-id="spawnSubChatId(block.message)" :title="spawnGoalLabel(block.message)" :status="spawnStatusOf(block.message)" :pending="!!pendingAsks[spawnSubChatId(block.message)]||pendingPermRequests.some(request=>request.chatId===spawnSubChatId(block.message))" :disabled="!spawnSubChatId(block.message)||isSpawnSubchatDeleted(block.message)" @open="routeConversationTarget" />
                <ConversationActivityRow v-else :message="block.message" :reveal="findToolReveal[block.message.id]" :label="toolActivityLabel(block.message,effectiveToolStatus(block.message),toolDisplay(block.message).label)" :icon="toolDisplay(block.message).icon" :status="effectiveToolStatus(block.message)" :expanded="isActivityExpanded(block.message.id)" @toggle="toggleTool(block.message.id)">
                  <div v-if="toolDownloadProgress(block.message)" class="tool-dl-progress"><span class="tool-dl-label">{{ toolDownloadProgressLabel(block.message) }}</span></div>
                  <button v-if="toolMediaSrc[block.message.id]" type="button" class="tool-media" @click="openToolMedia(block.message)"><img :src="toolMediaSrc[block.message.id]" alt="工具生成的预览" loading="lazy" /></button>
                  <ToolCatalogList :message="block.message" />
                </ConversationActivityRow>
              </div>

              <div
                v-else-if="block.type === 'chat'"
                v-show="!processMessageHidden(block.key)"
                class="msg"
                :data-message-phase="block.message.meta?.phase"
                :data-msg-id="block.message.id" tabindex="0"
                :class="[block.message.role]"
              >
                <div class="msg-row">
                  <div v-if="block.message.role !== 'assistant'" class="msg-avatar" :class="block.message.role" aria-hidden="true">
                    <span v-if="block.message.role === 'user'">你</span>
                    <AppIcon v-else icon="clipboard-list" />
                  </div>
                  <div class="msg-main">
                    <div v-if="block.message.role !== 'assistant'" class="msg-role">
                      <span>{{ roleLabel(block.message.role) }}</span>
                      <span class="msg-time" :title="formatTime(block.message.createdAt)">{{
                        formatRelative(block.message.createdAt)
                      }}</span>
                    </div>
                    <div v-if="block.message.meta?.refs?.length" class="msg-refs">
                      <span
                        v-for="r in block.message.meta.refs"
                        :key="refKey(r)"
                        class="chip"
                        :class="r.kind"
                      >
                        {{ chipLabel(r) }}
                      </span>
                    </div>
                    <div v-if="block.message.role==='user'&&messageTaskDeclarationLabel(block.message)" class="msg-task-declarations">本条：{{ messageTaskDeclarationLabel(block.message) }}</div>
                    <ConversationReasoning v-if="block.message.role==='assistant' && block.message.meta?.reasoning && processDetailsVisible(block.key)" :text="String(block.message.meta.reasoning)" />
                    <template v-if="block.message.role === 'assistant' || block.message.role === 'user'">
                      <ChatMarkdown
                        :chat-id="activeId || ''"
                        :content="displayMessageContent(block.message)"
                        :artifact-paths="replyFilesById.get(block.message.id)?.map(file=>file.path)"
                        :shimmer="isMessageShimmer(block.message)"
                        @open-media="(p) => openLightbox(p.src, p.alt)" @open-file="openFilePreview" @notify="onPanelNotify"
                      >
                        <template v-if="block.message.role === 'assistant' && replyFinalIds.has(block.message.id)" #footer>
                          <ReplyArtifacts v-if="replyFilesById.has(block.message.id)" :reply-id="block.message.id" :files="replyFilesById.get(block.message.id)!" @open="openFilePreview" @notify="onPanelNotify" />
                          <div class="reply-footer">
                            <button
                              v-if="showReadPages && messageSources(block.message).length"
                              type="button"
                              class="read-pages-bar"
                              :class="{ active: readPagesPanelOpen && readPagesPanelFromId === block.message.id }"
                              :aria-expanded="readPagesPanelOpen && readPagesPanelFromId === block.message.id"
                              @click="toggleReadPagesPanel(block.message.id, messageSources(block.message))"
                            >
                              <AppIcon icon="book" />
                              <span>{{ messageSources(block.message).length }} 个来源</span>
                              <AppIcon icon="chevron-down" class="read-pages-chevron" />
                            </button>
                            <button type="button" class="reply-copy-btn" :title="copiedMessageId === block.message.id ? '已复制' : '复制回答'" :aria-label="copiedMessageId === block.message.id ? '已复制' : '复制回答'" @click="copyReply(block.message)">
                              <StatusIcon v-if="copiedMessageId === block.message.id" kind="success" />
                              <AppIcon v-else icon="copy" />
                            </button>
                            <span v-if="assistantElapsedLabel(block.message)" class="msg-elapsed">{{ assistantElapsedLabel(block.message) }}</span>
                          </div>
                        </template>
                      </ChatMarkdown>
                    </template>
                    <div v-else class="msg-body">{{ block.message.content }}</div>
                  </div>
                </div>
              </div>
            </template>

            <div
              v-if="(showInlinePerm && permReq) || (showInlinePendingAsk && activePendingAsk)"
              ref="inlineDecisionEl"
              class="inchat-decision"
            >
              <InChatPermCard
                v-if="showInlinePerm && permReq"
                :req="permReq"
                :capability-label="permCapabilityLabel"
                :chat-title="permChatTitle"
                :remaining-label="permRemainingLabel"
                :remaining-urgent="permRemainingUrgent"
                :remaining-pct="permRemainingPct"
                :pending-count="permPendingCount"
                :busy="permBusyId===permReq?.id"
                :submission-error="decisionSubmissions[permReq.id]?.error"
                :expired="decisionSubmissions[permReq.id]?.expired"
                @dismiss="removePermRequest(permReq.id)"
                @decide="respondPerm"
              />
              <InChatAskCard
                v-if="showInlinePendingAsk && activePendingAsk"
                :req="activePendingAsk"
                :remaining-label="inlineAskRemainingLabel"
                :remaining-urgent="inlineAskRemainingUrgent"
                :remaining-pct="inlineAskRemainingPct"
                :key="activePendingAsk.id"
                :busy="askBusy"
                :submission-error="decisionSubmissions[activePendingAsk.id]?.error"
                :expired="decisionSubmissions[activePendingAsk.id]?.expired"
                @dismiss="clearPendingAsk(activePendingAsk.chatId,activePendingAsk.id)"
                @option="respondAskOption"
                @custom="respondAskCustomText"
                @deny="respondAskDeny"
              />
            </div>

            <div
              v-if="agentRunning && !showInlinePendingAsk && !showInlinePerm"
              class="thinking-row"
              aria-live="polite"
            >
              <StatusIcon kind="running" class="thinking-activity" spinAlways />
              <div class="thinking-bubble">
                <div class="thinking-label">{{ phaseLabel }}</div>
                <div
                  v-if="liveDownloadBar"
                  class="tool-dl-progress thinking-dl"
                >
                  <div
                    class="tool-dl-bar"
                    :class="{ indeterminate: liveDownloadBar.indeterminate }"
                    role="progressbar"
                    :aria-valuenow="liveDownloadBar.percent ?? undefined"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="liveDownloadBar.label"
                  >
                    <div
                      class="tool-dl-fill"
                      :style="
                        liveDownloadBar.indeterminate
                          ? undefined
                          : { width: `${liveDownloadBar.percent ?? 0}%` }
                      "
                    />
                  </div>
                  <span class="tool-dl-label">{{ liveDownloadBar.label }}</span>
                </div>
                <div v-if="liveReasoningText" class="transcript-activity transcript-reasoning" :class="{'is-open':liveReasoningOpen}">
                  <button
                    type="button"
                    class="transcript-activity-trigger"
                    :aria-expanded="liveReasoningOpen"
                    @click="toggleLiveReasoning"
                  >
                    <AppIcon icon="lightbulb" />
                    <span class="thinking-reason-title">
                      思考中
                      <span v-if="liveReasoningRoundLabel" class="thinking-reason-round">{{
                        liveReasoningRoundLabel
                      }}</span>
                    </span>
                    <AppIcon class="activity-chevron" icon="chevron-right" />
                  </button>
                  <DisclosureTransition>
                  <div
                    v-if="liveReasoningOpen"
                    ref="liveReasoningBodyEl"
                    class="thinking-reason-body transcript-activity-detail reasoning-detail"
                  >
                    {{ liveReasoningText }}
                  </div>
                  </DisclosureTransition>
                </div>
                <ChatMarkdown
                  v-if="liveAnswerText && activeId"
                  data-live-answer
                  :chat-id="activeId"
                  :content="liveAnswerText"
                />
              </div>
            </div>

            <div v-else-if="showRetryBar" class="retry-bar">
              <button
                type="button"
                class="retry-btn"
                :disabled="retrying || agentRunning || sending"
                title="重新执行上次提问"
                @click="retryLast"
              >
                <AppIcon icon="arrow-rotate-right" class="mr-1" />
                {{ retrying ? '重试中…' : '重试' }}
              </button>
            </div>

            <div v-else-if="showFollowupBlock" class="followup-block">
              <div v-if="storeFollowups.length" class="followup-store">
                <div class="followup-label">推荐安装</div>
                <div class="catalog-item-list">
                  <CatalogItemCard
                    v-for="s in storeFollowups"
                    :key="followupKey(s)"
                    :name="s.action.type === 'store_install' ? s.action.name || s.label : s.label"
                    :id-line="
                      s.action.type === 'store_install'
                        ? `${s.action.kind === 'skill' ? '技能' : '插件'} · ${s.action.productId}`
                        : ''
                    "
                    :description="
                      s.action.type === 'store_install' ? s.action.description || '' : ''
                    "
                    :tags="[s.action.type === 'store_install' && s.action.kind === 'skill' ? '技能' : '插件']"
                    clickable
                    @click="useSuggestion(s)"
                  >
                    <template #actions>
                      <v-btn size="small" color="primary" @click="useSuggestion(s)">安装</v-btn>
                    </template>
                  </CatalogItemCard>
                </div>
              </div>
              <div v-if="textFollowups.length" class="followup-prompts">
                <div class="followup-label">相关追问</div>
                <div class="followup-chips">
                  <button
                    v-for="s in textFollowups"
                    :key="followupKey(s)"
                    type="button"
                    class="suggest-chip"
                    :class="{ 'suggest-chip--action': s.action.type !== 'prompt' }"
                    @click="useSuggestion(s)"
                  >
                    {{ s.label }}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <ConversationOutline :messages="active.messages" :scroll-container="msgBox" @jump="jumpToMessage" @navigate="onOutlineNavigate" />

          <button
            v-if="showJumpBottom"
            type="button"
            class="jump-bottom"
            title="回到底部"
            aria-label="回到底部"
            @click="jumpToBottom"
          >
            <AppIcon icon="arrow-down" />
          </button>
        </div>

        <footer
          class="composer"
          :class="{ 'drop-active': dropActive, running: agentRunning }"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent="onDragOver"
          @dragleave="onDragLeave"
          @drop.prevent="onDrop"
        >
          <button
            v-if="(showInlinePendingAsk || showInlinePerm) && !inlineDecisionVisible"
            type="button"
            class="pending-ask-dock"
            @click="scrollToInlineDecision"
          >
            <StatusIcon kind="ask" class="pending-ask-dock-icon" />
            <span class="pending-ask-dock-body">
              <span class="pending-ask-dock-label">
                {{
                  showInlinePerm && !showInlinePendingAsk
                    ? '需要授权'
                    : activePendingAsk?.kind === 'continue_rounds'
                      ? '待决策'
                      : activePendingAsk?.kind === 'download_confirm'
                        ? '待决策'
                        : '询问/决策'
                }}
                <template v-if="inlineAskProgress"> · {{ inlineAskProgress }}</template>
              </span>
              <span class="pending-ask-dock-q">{{
                showInlinePerm && !showInlinePendingAsk
                  ? permCapabilityLabel
                  : activePendingAsk?.question
              }}</span>
            </span>
            <span
              v-if="inlineAskRemainingLabel || (showInlinePerm && permRemainingLabel)"
              class="pending-ask-dock-timeout"
            >{{
              inlineAskRemainingLabel || permRemainingLabel
            }}</span>
            <span class="pending-ask-dock-action">{{
              showInlinePerm && !showInlinePendingAsk ? '授权' : '选择'
            }}</span>
            <span
              v-if="inlineAskRemainingLabel"
              class="pending-ask-dock-bar"
              :class="{ urgent: inlineAskRemainingUrgent }"
              aria-hidden="true"
            >
              <span
                class="pending-ask-dock-bar-fill"
                :style="{ width: `${inlineAskRemainingPct}%` }"
              />
            </span>
          </button>
          <div v-for="questionnaire in questionnaireDocks" :key="questionnaire.id" class="questionnaire-pending-dock"><button type="button" @click="openQuestionnaireRecord(questionnaire)"><AppIcon icon="list-ul" /><span><strong>{{questionnaire.title}}</strong><small>{{questionnaire.questions.length}} 个问题<template v-if="questionnaire.chatId!==activeId"> · 子任务</template></small></span><span class="questionnaire-dock-action">打开填写</span></button></div>
          <MessageQueue :key="activeId || ''" :chat-id="activeId || ''" :files="artifactEntries" :messages="active?.messages || []" :context-previews="contextPreviews" :entries="active?.queuedMessages || []" :paused="active?.queuePaused === true" :busy="queueBusy" :max-chars="maxComposerChars" @edit="(id,content,document,revision)=>changeQueue('edit',id,content,document,revision)" @recover="recoverComposerDocument" @open-source="openComposerSource" @notify="onPanelNotify" @remove="changeQueue('remove',$event)" @insert="changeQueue('insert',$event)" @resume="changeQueue('resume')"  @creator="openCreator" />
          <p v-if="modelSelectionBusy||executionModeBusy" class="composer-validation" role="status" aria-live="polite">正在保存选择…</p><p v-else-if="modelLoadError||modelSelectionInvalid||!chatModelKey" class="composer-validation" role="status">{{modelLoadError||'请先选择可用模型后发送。'}} <button type="button" @click="modelMenuOpen=true">选择模型</button></p>
          <p v-if="composerProblem" class="composer-validation" role="status">{{ composerProblem }}</p>
          <p v-if="draftUnsupported" class="composer-validation" role="alert">原始草稿使用了当前版本无法读取的格式，已完整保留。此处仅显示可读副本；请升级到兼容版本后恢复编辑和发送。</p>
          <p v-if="active?.draftUnsupportedRecoveries?.length" class="composer-validation" role="status">另有 {{ active.draftUnsupportedRecoveries.length }} 份较新格式的草稿备份已保留，请在兼容版本中恢复。</p>
          <div v-if="draftConflict" class="composer-draft-recovery" role="status"><strong>草稿在另一处有更新</strong><details><summary>查看两份内容</summary><p>当前编辑</p><pre>{{ draft }}</pre><p>同步版本</p><pre>{{ draftConflict.draft }}</pre></details><div><button type="button" @click="draftState.resolveConflict(true)">保留当前编辑</button><button type="button" @click="draftState.resolveConflict(false)">使用同步版本</button></div></div>
          <div v-for="pending in visibleSubmissions" :key="pending.id" class="composer-pending-submit" role="status"><span>{{ pending.failed ? '提交失败，内容已保留' : '正在提交，确认后开始执行或进入队列…' }}</span><details><summary>查看内容</summary><pre>{{ pending.text }}</pre></details><button v-if="pending.failed" type="button" @click="restoreFailedSubmission(pending.id)">放回编辑器</button><button v-if="pending.failed" type="button" @click="dismissFailedSubmission(pending.id)">移除</button></div>
          <div v-for="recovery in visibleDraftRecoveries" :key="recovery.id" class="composer-draft-recovery"><span>{{ recovery.reason==='conflict'?'已保留一份同步冲突的草稿':'有一份未确认提交的草稿快照' }}</span><details><summary>查看内容</summary><pre>{{ previewComposerDocument(recovery.document).content }}</pre></details><button v-if="recovery.reason==='send_failed'" type="button" :disabled="sending" @click="retryDraftRecovery(recovery.id)">重试提交</button><button type="button" @click="restoreDraftRecovery(recovery.id)">放回编辑器</button><button type="button" @click="dismissDraftRecovery(recovery.id)">移除</button></div>
          <div class="composer-box">

            <div class="composer-input-row" @compositionstart.capture="onComposerCompositionStart" @compositionend.capture="onComposerCompositionEnd">
              <ComposerEditor ref="draftField" class="composer-input" :model-value="composerDocument" :disabled="composerStaging===activeId" :readonly="draftUnsupported" :context-previews="contextPreviews" :chat-id="activeId || ''" :placeholder="activeOwnQuestionnaire ? '有疑问可以补充，发送后切回聊天…' : agentRunning ? '继续输入，加入队列…' : '描述任务，输入 / 附加内容或使用工具…'" @update:model-value="draftState.edited" @submit="send" @attach="onAttachRequest" @open-source="openComposerSource" @refresh-source="refreshComposerSource" @change-source="changeComposerSource" @notify="onPanelNotify" />

            </div>
            <div
              v-if="draftNearLimit || draftAtLimit"
              class="composer-limit"
              :class="{ danger: draftAtLimit }"
            >
              {{ draftLen }} / {{ maxComposerChars }}
            </div>
            <div class="composer-actions">
              <div class="composer-actions-left">
                <button type="button" class="composer-perm-btn composer-attach-trigger" title="附加文件、网页或会话，也可输入 /" aria-label="附加" :disabled="!activeId||draftUnsupported" @mousedown.prevent="captureComposerSelection" @click="openAttachmentMenu()"><AppIcon icon="paperclip" /></button>
                <v-menu v-model="modeMenuOpen" :attach="composerMenuBoundary" contained location="top start" :disabled="agentRunning">
                  <template #activator="{ props: modeProps }"><button type="button" class="composer-perm-btn execution-mode-button" v-bind="modeProps" :disabled="agentRunning || sending || executionModeBusy || modelSelectionBusy" aria-label="回答方式" :aria-busy="executionModeBusy"><AppIcon :icon="executionModeIcon" />{{ executionModeLabel }}<AppIcon icon="chevron-down" /></button></template>
                  <div class="composer-perm-panel" role="menu" aria-label="回答方式">
                    <button v-for="mode in executionModes" :key="mode.id" type="button" class="composer-perm-item" role="menuitemradio" :aria-checked="(active?.executionMode || 'auto') === mode.id" @click="applyExecutionMode(mode.id)"><AppIcon :icon="mode.icon" class="composer-perm-item-icon"/><span class="composer-perm-item-label">{{ mode.label }}</span><span class="composer-perm-item-desc">{{ mode.hint }}</span></button>
                  </div>
                </v-menu>
                <v-menu
                  v-model="permMenuOpen"
                  :attach="composerMenuBoundary" contained
                  location="top start"
                  :close-on-content-click="true"
                  content-class="composer-perm-menu"
                >
                  <template #activator="{ props: menuProps }">
                    <button
                      type="button"
                      class="composer-perm-btn"
                      v-bind="menuProps"
                      title="本会话权限预设"
                      aria-label="本会话权限预设"
                    >
                      <AppIcon :icon="permPresetIcon" />
                      <span>{{ permPresetLabel }}</span>
                    </button>
                  </template>
                  <div class="composer-perm-panel" role="menu">
                    <div class="composer-perm-title">本会话权限</div>
                    <button
                      v-for="opt in permPresetOptions"
                      :key="opt.value"
                      type="button"
                      class="composer-perm-item"
                      :class="{ active: chatPermissions.preset === opt.value }"
                      role="menuitem"
                      @click="applyChatPreset(opt.value)"
                    >
                      <AppIcon :icon="opt.icon" class="composer-perm-item-icon" />
                      <span class="composer-perm-item-label">{{ opt.title }}</span>
                      <span class="composer-perm-item-desc">{{ opt.desc }}</span>
                      <AppIcon
                        v-if="chatPermissions.preset === opt.value"
                        icon="check"
                        class="composer-perm-check"
                      />
                    </button>
                  </div>
                </v-menu>
              </div>

              <div class="composer-actions-right">
                <v-menu
                  v-model="modelMenuOpen"
                  :attach="composerMenuBoundary" contained
                  location="top end"
                  :close-on-content-click="false"
                  :disabled="agentRunning"
                  content-class="composer-perm-menu"
                >
                  <template #activator="{ props: menuProps }">
                    <button
                      type="button"
                      class="composer-perm-btn model-panel-trigger"
                      v-bind="menuProps"
                      :disabled="agentRunning"
                      :title="`${chatModelLabel}${reasoningLevels.length?' · '+reasoningLabel(selectedReasoningLevel):''}`"
                      aria-label="本会话模型"
                    >
                      <AppIcon icon="microchip" />
                      <span class="model-trigger-label">{{ chatModelLabel }}</span><span v-if="reasoningLevels.length" class="model-trigger-tier">{{ reasoningLabel(selectedReasoningLevel) }}</span><AppIcon icon="chevron-down" />
                    </button>
                  </template>
                  <div class="composer-perm-panel unified-model-panel" @keydown="modelPanelKey" role="dialog" aria-label="模型与思考等级">
                    <div class="model-panel-heading">模型与思考等级<button type="button" aria-label="关闭模型面板" @click="modelMenuOpen=false"><AppIcon icon="xmark" /></button></div>
                    <label class="model-panel-search"><AppIcon icon="magnifying-glass" /><input v-model="modelQuery" placeholder="搜索模型或服务商" aria-label="搜索模型" @keydown.esc="modelMenuOpen=false" /></label>
                    <p v-if="modelLoading" role="status" class="composer-model-empty">正在读取模型…</p><div v-else-if="modelLoadError" class="composer-model-empty" role="alert">{{modelLoadError}} <button type="button" class="ui-button" @click="refreshAiProviders()">重试</button></div><p v-else-if="modelSelectionInvalid" role="alert" class="composer-model-empty">原服务商已移除，请重新选择模型。</p>
                    <div class="model-panel-options" role="group" aria-label="选择模型">
                    <section v-for="group in modelOptionGroups" :key="group.id" :aria-label="group.label"><h4 class="model-provider-label">{{group.label}}</h4><button
                      v-for="opt in group.options"
                      :key="opt.key"
                      type="button"
                      class="composer-perm-item"
                      :class="{ active: opt.key === chatModelKey }"
                      role="radio" :aria-checked="opt.key === chatModelKey" :disabled="modelSelectionBusy || executionModeBusy || modelLoading || sending || agentRunning"
                      :title="`${opt.providerLabel} · ${opt.model}${opt.hasKey ? '' : '（未保存 Key；本地端点可能无需密钥）'}`"
                      @click="applyChatModel(opt.providerId, opt.model)"
                    >
                      <AppIcon icon="microchip" class="composer-perm-item-icon" />
                      <span class="composer-perm-item-label">{{ opt.label }}</span>
                      <span class="composer-perm-item-desc">{{
                        `${opt.capabilities}${opt.hasKey ? '' : ' · 未保存密钥'}`
                      }}</span>
                      <AppIcon
                        v-if="opt.key === chatModelKey"
                        icon="check"
                        class="composer-perm-check"
                      />
                    </button></section>
                    <p v-if="!modelLoading && !modelLoadError && !filteredModelOptions.length" class="composer-model-empty">
                      {{ modelMenuOptions.length ? '没有匹配的模型' : '暂无模型，请到设置添加' }}
                    </p>
                    </div>
                    <div v-if="reasoningLevels.length" class="model-panel-reasoning" role="group" aria-label="思考等级"><span>思考等级</span><div><button v-for="level in reasoningLevels" :key="level.id" type="button" :class="{selected:selectedReasoningLevel===level.id}" :aria-pressed="selectedReasoningLevel===level.id" :disabled="modelSelectionBusy || executionModeBusy || modelLoading || sending || agentRunning" @click="applyReasoningLevel(level.id)">{{ reasoningLabel(level.id) }}</button></div></div>
                  </div>
                </v-menu>

                <v-menu
                  v-model="usageMenuOpen"
                  :attach="composerMenuBoundary" contained
                  location="top end"
                  :close-on-content-click="true"
                  content-class="composer-usage-menu"
                >
                  <template #activator="{ props: menuProps }">
                    <button
                      type="button"
                      class="usage-ring-btn"
                      v-bind="menuProps"
                      :title="`上下文估算 ${usagePctLabel}`"
                      :aria-label="`查看上下文估算，约占 ${usagePctLabel}`"
                    >
                      <svg class="usage-ring" viewBox="0 0 36 36" aria-hidden="true">
                        <circle class="usage-ring-track" cx="18" cy="18" r="14" fill="none" />
                        <circle
                          class="usage-ring-value"
                          :class="usageTone"
                          cx="18"
                          cy="18"
                          r="14"
                          fill="none"
                          :stroke-dasharray="usageDash"
                          transform="rotate(-90 18 18)"
                        />
                      </svg>
                    </button>
                  </template>
                  <div class="composer-usage-panel">
                    <div class="composer-usage-heading">
                      <span>上下文估算 <b>{{ usagePctLabel }}</b></span>
                      <strong>~{{ formatUsageCount(usageTokensEst) }} / {{ formatUsageCount(chatModelSettings.context_window) }}</strong>
                    </div>
                    <div class="composer-usage-track" role="progressbar" :aria-valuenow="Math.min(100, Math.round(usageRatio * 100))" aria-valuemin="0" aria-valuemax="100" :aria-label="`对话内容估算占上下文 ${usagePctLabel}`">
                      <span class="composer-usage-fill" :class="usageTone" :style="{ width: `${Math.min(100, usageRatio * 100)}%` }"></span>
                    </div>
                    <div class="composer-usage-breakdown">
                      <div class="composer-usage-row">
                        <span><i class="usage-dot system"></i>系统提示词</span>
                        <strong>未计入</strong>
                      </div>
                      <div class="composer-usage-row">
                        <span><i class="usage-dot tools"></i>工具定义</span>
                        <strong>未计入</strong>
                      </div>
                      <div class="composer-usage-row">
                        <span><i class="usage-dot message-history"></i>对话消息</span>
                        <strong>~{{ formatUsageCount(usageHistoryEst) }}</strong>
                      </div><div class="composer-usage-row"><span>当前输入</span><strong>~{{formatUsageCount(usageDraftEst)}}</strong></div>
                    </div>
                    <div class="composer-usage-actual"><strong>最近一次服务返回{{actualUsageModel?` · ${actualUsageModel}`:''}}</strong><template v-if="actualUsage"><div class="composer-usage-row"><span>输入 / 输出</span><span>{{formatUsageCount(actualUsage.inputTokens)}} / {{formatUsageCount(actualUsage.outputTokens)}}</span></div><div class="composer-usage-row"><span>总用量</span><span>{{formatUsageCount(actualUsage.totalTokens)}}</span></div><div v-if="actualUsage.cachedInputTokens!==undefined" class="composer-usage-row"><span>缓存命中</span><span>{{formatUsageCount(actualUsage.cachedInputTokens)}}</span></div></template><p v-else>服务尚未返回用量数据</p></div>
                    <p class="composer-usage-note">
                      按历史消息及当前输入的 UTF-8 字节粗略估算，不含系统提示词、工具定义、图片和文件内容。不会代表下一次请求的完整预算。输出上限 {{ chatModelSettings.max_output_tokens.toLocaleString() }} token。
                    </p>
                  </div>
                </v-menu>

                <ComposerSendButton :label="activeOwnQuestionnaire && composerMainMode!=='stop' ? '发送并切回聊天' : undefined" :mode="composerMainMode" :disabled="composerComposing||(composerMainMode!=='stop'&&!canSend)" :busy="sending" @submit="onComposerMainAction"/>
              </div>
            </div>
          </div>
        </footer>
      </template>
      <div v-else class="empty-main">
        <div class="empty-card">
          <div class="empty-title">还没有选中的 Chat</div>
          <v-btn color="primary" size="small" @click="createChat">
            <AppIcon icon="pen-to-square" class="new-chat-icon" />
            开启新对话
          </v-btn>
        </div>
      </div>
      </div>
      </template>
      <Transition name="resource-card">
        <ConversationResourcesCard v-if="!docsOpen && resourceOpen && activeId && !settingsOpen && !creatorKind && !fileManagerActive && !pluginWorkspaceActive && !browserWorkspaceActive" :chat-id="activeId" :title="active?.title || '新对话'" :messages="active?.messages || []" :tree="tree" :tab="resourceTab" :width="previewWidth" :overlay="resourceOverlay" :available-width="resourceAvailableWidth" :is-remote="isWebRemote()" :owner-label="treeOwnerLabel" :dnd-mime="DND_MIME" @close="closeResources" @tab="resourceTab=$event" @resize="setPreviewWidth" @preview="openFilePreview" @notify="onPanelNotify" @add-ref="addRef" @ask-close-session="askCloseSession" @remote-view="openRemoteWindow" @jump="locateResourceMessage({chatId:activeId!,messageId:$event})" @open-media="(p) => openLightbox(p.src,p.alt)" />
      </Transition>
    <Transition name="file-workspace"><FileWorkspace ref="fileWorkspace" :presented="(fileWorkspaceVisible||browserWorkspaceActive)&&!settingsOpen&&!creatorKind&&!docsOpen" v-if="fileTabsState.open || browserWorkspaceMode" v-show="!docsOpen && !settingsOpen && (fileWorkspaceVisible || browserWorkspaceActive)" :inert="settingsOpen" @questionnaire-submitted="acceptQuestionnaireRecord($event)" @questionnaire-cancelled="acceptQuestionnaireRecord($event)" @questionnaire-return-to-chat="onQuestionnaireReturnToChat" @tools-target="workspaceToolsTarget=$event" @conversation-detach="restoreConversationSplit" @creator="openCreator" @select-subchat="selectWorkspaceSubchat" @locate-parent="locateSubchatParent" :full-page="browserWorkspaceMode" :tabs="browserWorkspaceMode?browserWorkspaceTabs:fileTabsState.tabs" :workspace-count="fileTabsState.tabs.length" :active="settingsOpen ? null : browserWorkspaceMode?browserWorkspaceTab:activeFileTab" :viewer-chat-id="activeId || ''" :width="fileWorkspaceWidth" :maximum="fileWorkspaceMaximum" :overlay="fileWorkspaceOverlay" :expanded="browserExpanded" :expand-preview="workspaceExpandPreview" :conversation-preview="workspaceConversationPreview" :conversation="browserExpanded&&!browserWorkspaceMode?{title:active?.title||'当前对话',active:workspaceConversationActive,status:workspaceConversationStatus}:undefined" :running="agentRunning" @conversation="showWorkspaceConversation" @stop="stopAgent" :owner-label="treeOwnerLabel" :resolve-browser="resolveBrowserTab" @open-browser="openBrowserTab" @browser-changed="updateBrowserTab" @reorder="(id,before,ids)=>reorderBrowserTab(id,before,activeId,ids)" @tab-expand="toggleWorkspaceTabExpanded" @expand="toggleBrowserExpand" @select="selectFileTab" @close="closeFileTab" @hide="hideWorkspace" @open-file="openFilePreview($event.path,$event.chatId)" @locate="locateResourceMessage" @resize="resizeFileWorkspace" @notify="onPanelNotify" /></Transition>
    </main>
    </div>

    <NativePanelDialog
      :model-value="readPagesPanelOpen"
      :active="!settingsOpen&&!creatorKind"
      :content="readSourcesNative.content"
      :context-key="`${activeId}:${readPagesPanelFromId}`"
      title="引用来源"
      max-width="540"
      scrollable
      content-class="read-pages-dialog-host"
      @action="readSourcesAction"
      @error="showToast($event)"
      @update:model-value="onReadPagesDialog"
    >
      <div class="read-pages-dialog" aria-label="引用来源">
        <header class="read-pages-dialog-head">
          <div>
            <h2>引用来源</h2>
            <p>{{ readPagesPanelList.length }} 个来源</p>
          </div>
          <button type="button" class="read-pages-dialog-close" title="关闭" @click="closeReadPagesPanel">
            <AppIcon icon="xmark" />
          </button>
        </header>
        <div class="read-pages-dialog-list">
          <button
            v-for="(s, i) in readPagesPanelList"
            :key="`${s.url}-${i}`"
            type="button"
            class="read-page-card"
            @click="openSourceUrl(s.url)"
            @contextmenu="appLinks.showLinkMenu(s.url,$event,activeId||undefined)"
          >
            <div class="read-page-card-top">
              <img
                class="read-page-card-icon"
                :src="s.favicon || faviconFallback(s.url)"
                alt=""
                loading="lazy"
                @error="onFaviconError"
              />
              <span class="read-page-site">{{ s.siteName || hostOf(s.url) }}</span>
            </div>
            <div class="read-page-title">{{ s.title || hostOf(s.url) }}</div>
            <div class="read-page-snippet">{{ s.snippet || s.url }}</div>
          </button>
        </div>
      </div>
    </NativePanelDialog>


    <BrowserConfirmationDialog v-model="deleteDialog" confirmation="delete-chat" :context-key="deleteTarget?.id||deleteBatchIds?.join(',')||''" max-width="440" persistent>
      <v-card>
        <v-card-title>{{ deleteBatchIds?.length ? '批量删除对话' : '删除 Chat' }}</v-card-title>
        <v-card-text>
          <p v-if="deleteBatchIds?.length">
            确定删除选中的 <strong>{{ deleteBatchIds.length }}</strong> 个对话吗？
          </p>
          <p v-else>
            确定删除
            <strong>{{ displayChatTitle(deleteTarget?.title) }}</strong>
            吗？
          </p>
          <p class="text-medium-emphasis mt-2">
            将同时停止其中的 Agent，并销毁其下全部浏览器 Session / 窗口与持久化数据。此操作不可恢复。
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="deleting" @click="cancelDeleteChat">取消</v-btn>
          <v-btn color="error" :loading="deleting" @click="confirmDeleteChat">删除</v-btn>
        </v-card-actions>
      </v-card>
    </BrowserConfirmationDialog>

    <BrowserConfirmationDialog v-model="closeSessionDialog" confirmation="close-session" max-width="420" persistent>
      <v-card>
        <v-card-title>关闭 Session</v-card-title>
        <v-card-text>
          <p>
            确定关闭
            <strong>{{ closeSessionTarget?browserSessionLabel(closeSessionTarget):'浏览会话' }}</strong>
            吗？
          </p>
          <p class="text-medium-emphasis mt-2">
            其下所有浏览器窗口将被销毁；持久化数据也会清除。
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="closingSession" @click="cancelCloseSession">取消</v-btn>
          <v-btn color="error" :loading="closingSession" @click="confirmCloseSession">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </BrowserConfirmationDialog>

    <BrowserConfirmationDialog v-model="quitDialog" confirmation="quit" max-width="400" persistent>
      <v-card class="app-quit-dialog" :aria-busy="quitChecking||quitting">
        <v-card-title>退出 Navora</v-card-title>
        <v-card-text aria-live="polite">{{ quitMessage }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="quitting" @click="quitDialog = false">取消</v-btn>
          <v-btn v-if="quitStateError" variant="text" :disabled="quitting||quitChecking" @click="quitConfirmation.refresh()">重试</v-btn>
          <v-btn color="error" :disabled="!quitReady" :loading="quitting" @click="confirmQuit">退出</v-btn>
        </v-card-actions>
      </v-card>
    </BrowserConfirmationDialog>

    <SidebarContextMenu ref="pageCtxMenu">
      <template v-if="pageCtx?.kind === 'chat' || pageCtx?.kind === 'sub'">
        <button type="button" class="sidebar-more-item" role="menuitem" @click="runChatContextAction('find')"><AppIcon icon="magnifying-glass"/><span>在此对话查找</span></button>
        <button type="button" class="sidebar-more-item" role="menuitem" :disabled="isWebRemote()" :title="isWebRemote()?'远程界面不能打开本机文件夹':undefined" @click="runChatContextAction('folder')"><AppIcon icon="folder-open"/><span>打开对话文件夹</span></button>
        <button type="button" class="sidebar-more-item" role="menuitem" :disabled="!pageCtx.running||!pageCtx.runId" @click="runChatContextAction('stop')"><StatusIcon kind="stopped"/><span>停止本对话任务</span></button>
        <div class="sidebar-more-divider" role="separator"/>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="runChatContextAction('rename')">
          <AppIcon icon="pen-to-square" />
          <span>修改标题</span>
        </button>
        <button
          v-if="pageCtx.kind === 'chat'"
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          @click="runChatContextAction('pin')"
        >
          <AppIcon icon="thumbtack" />
          <span>{{ pageCtx.chat.pinned ? '取消置顶' : '置顶' }}</span>
        </button>
        <button
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          :disabled="exportingChat || !pageCtx.chat.messages?.length"
          @click="runChatContextAction('export')"
        >
          <AppIcon icon="file-export" />
          <span>导出对话</span>
        </button>
        <button type="button" class="sidebar-more-item danger" role="menuitem" @click="runChatContextAction('delete')">
          <AppIcon icon="trash" />
          <span>删除</span>
        </button>
      </template>
      <template v-else-if="pageCtx?.kind === 'msg'">
        <template v-if="pageCtx.selected">
          <div class="sidebar-ctx-label" role="presentation">文本</div>
          <button
            type="button"
            class="sidebar-more-item"
            role="menuitem"
            @click="runMessageContextAction('copy-selection')"
          >
            <AppIcon icon="copy" />
            <span>复制</span>
          </button>
          <button
            type="button"
            class="sidebar-more-item"
            role="menuitem"
            @click="runMessageContextAction('quote-selection')"
          >
            <AppIcon icon="pen-to-square" />
            <span>引用到输入框</span>
          </button>
        </template>
        <template v-if="pageCtx.messageText || pageCtx.hasChat">
          <div
            class="sidebar-ctx-label"
            :class="{ 'with-sep': !!pageCtx.selected }"
            role="presentation"
          >
            对话
          </div>
          <button
            v-if="pageCtx.messageText"
            type="button"
            class="sidebar-more-item"
            role="menuitem"
            @click="runMessageContextAction('copy-message')"
          >
            <AppIcon icon="copy" />
            <span>复制本条</span>
          </button>
          <button
            v-if="pageCtx.messageText"
            type="button"
            class="sidebar-more-item"
            role="menuitem"
            @click="runMessageContextAction('quote-message')"
          >
            <AppIcon icon="pen-to-square" />
            <span>引用本条到输入框</span>
          </button>
          <button
            v-if="pageCtx.hasChat"
            type="button"
            class="sidebar-more-item"
            role="menuitem"
            @click="runMessageContextAction('copy-chat')"
          >
            <AppIcon icon="comments" />
            <span>复制全部对话</span>
          </button>
          <button
            v-if="pageCtx.hasChat"
            type="button"
            class="sidebar-more-item"
            role="menuitem"
            :disabled="exportingChat"
            @click="runMessageContextAction('export')"
          >
            <AppIcon icon="file-export" />
            <span>导出对话</span>
          </button>
        </template>
      </template>
    </SidebarContextMenu>

    <SidebarContextMenu ref="railContextMenu"><button type="button" class="sidebar-more-item" role="menuitemcheckbox" :aria-checked="!allSidebarHidden" :disabled="!!settingsOpen||!!creatorKind" @click="toggleSidebarVisibility"><AppIcon :icon="allSidebarHidden?'sidebar-show':'sidebar-hide'"/><span>显示侧栏</span><span class="rail-context-check" aria-hidden="true">{{allSidebarHidden?'':'✓'}}</span></button><div class="sidebar-more-divider"/><button type="button" class="sidebar-more-item" role="menuitemcheckbox" :aria-checked="sidebarFloatingDisabled || sidebarPresentationMode==='fixed'" :disabled="isMobileLayout||!!settingsOpen||!!creatorKind||sidebarFloatingDisabled" :title="sidebarFloatingDisabledReason||undefined" @click="toggleSidebarPin"><AppIcon :icon="sidebarFloatingDisabled || sidebarPresentationMode==='fixed'?'sidebar-docked':'sidebar-floating'"/><span>固定侧栏</span><span class="rail-context-check" aria-hidden="true">{{sidebarFloatingDisabled||sidebarPresentationMode==='fixed'?'✓':''}}</span></button></SidebarContextMenu>
    <ApplicationMenuBar v-if="!showDesktopChrome || isMobileLayout" ref="appMenu" mode="compact" collapsed :command-state="applicationCommandState" :context-key="activeId || ''" :app-version="applicationVersion" :shortcuts-active="!settingsOpen&&!docsOpen&&!creatorKind" :capture-target="captureApplicationTarget" :restore-target="restoreApplicationTarget" @beforeopen="refreshApplicationTarget" @command="executeApplicationCommand" @error="onPanelNotify" />
    <ComposerAttachmentMenu ref="attachmentMenu" :chat-id="activeId||''" :files="artifactEntries" :messages="active?.messages||[]" @insert="insertContextSources" :context-key="activeId||''" :selected-declarations="selectedTaskDeclarations" @declaration="selectTaskDeclaration" @select="selectAttachmentSource" @creator="createFromAttachment" @closed="attachmentClosed" @notify="onPanelNotify" />
    <WorkspaceFilePickerDialog v-model="applicationFilePicker" :active="!settingsOpen&&!creatorKind" :chat-id="activeId || ''" title="打开对话文件" :show-locate="false" @open="path=>{applicationFilePicker=false;openFilePreview(path)}" @error="showToast($event)" />

    <NativePanelDialog v-model="chatSearchOpen" :active="!settingsOpen&&!creatorKind" :content="chatSearchNative.content" :initial-content="chatSearchNativeInitial" context-key="chat-search" title="搜索对话" focus-mode="input" role="search" position="top" :focus-request="chatSearchFocusRequest" max-width="600" content-class="chat-search-dialog" aria-label="搜索对话" @action="chatSearchAction" @error="showToast($event)" @after-enter="chatSearchInput?.focus()">
        <div class="chat-search-panel">
          <div class="chat-search-box">
            <AppIcon icon="magnifying-glass" class="chat-search-lead" />
            <input
              ref="chatSearchInput"
              v-model="chatSearchQuery"
              type="search"
              class="chat-search-input"
              placeholder="搜索对话标题或消息内容…"
              autocomplete="off"
              spellcheck="false"
              @keydown.enter.prevent="pickFirstSearchHit"
            />
            <button
              type="button"
              class="chat-search-close"
              title="关闭"
              @click="closeChatSearch"
            >
              <AppIcon icon="xmark" />
            </button>
          </div>
          <div class="chat-search-results">
            <p v-if="!chatSearchQuery.trim()" class="chat-search-hint">最近对话 · 输入关键词搜索标题或消息</p>
            <p v-if="chatSearchQuery.trim() && !chatSearchHits.length" class="chat-search-hint">没有匹配的对话</p>
            <button
              v-for="hit in chatSearchHits"
              :key="hit.id"
              type="button"
              class="chat-search-hit"
              :class="{ active: hit.id === activeId }"
              @click="pickSearchChat(hit.id)"
            >
              <div class="chat-search-hit-title">{{ hit.title }}</div>
              <div v-if="hit.snippet" class="chat-search-hit-snippet">{{ hit.snippet }}</div>
              <div class="chat-search-hit-meta">{{ formatRelative(hit.updatedAt) }}</div>
            </button>
          </div>
        </div>
    </NativePanelDialog>

    <BrowserContentDialog :model-value="!!lightbox.src" max-width="1200" width="94vw" @update:model-value="!$event && closeLightbox()">
      <div
        v-if="lightbox.src"
        class="media-lightbox"
        role="dialog"
        aria-label="图片预览"
        tabindex="0"
        @click.self="closeLightbox"
        @keydown.esc.prevent="closeLightbox"
      >
        <button type="button" class="media-lightbox-close" title="关闭" aria-label="关闭图片预览" @click="closeLightbox">
          <AppIcon icon="xmark" />
        </button>
        <img :src="lightbox.src" :alt="lightbox.alt" />
        <p v-if="lightbox.alt" class="media-lightbox-cap">{{ lightbox.alt }}</p>
      </div>
    </BrowserContentDialog>




    <SkillReviewHost />

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2800" location="bottom end" :transition="false" variant="tonal" class="app-toast">
      <button type="button" class="app-toast-dismiss" :aria-label="`${toast.text}，点击关闭提示`" @click="toast.show=false"><span>{{ toast.text }}</span><AppIcon icon="xmark" /></button>
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import AppIcon from '@/components/icons/AppIcon.vue'
defineOptions({ name: 'ChatPage' })
import {finalOutputs} from '@shared/message-presentation'
import {conversationOutputBlocks,conversationProcessGroups,toolActivityLabel} from '@shared/conversation-output'
import {useChatAnnotations} from '@/composables/useChatAnnotations'
import type {AnnotationChatAction,AnnotationChatEntry,AnnotationChatEdit} from '@shared/browser-annotation-chat'
import {requestAnnotationEdit,cancelAnnotationEdit} from '@/composables/annotationChatEditor'
import ConversationProcessToggle from '@/components/ConversationProcessToggle.vue'
import ComposerSendButton from '@/components/ComposerSendButton.vue'
import {useAppLinks} from '@/composables/useAppLinks'
import {browserSessionLabel} from '@shared/browser-session'
import ConversationActivityRow from '@/components/ConversationActivityRow.vue'
import ConversationReasoning from '@/components/ConversationReasoning.vue'
import SubchatLink from '@/components/SubchatLink.vue'
import {useSubchatSignals} from '@/composables/useConversationSession'
import { replyArtifactGroups } from '@shared/workspace-resources'
import { useWorkspaceResources } from '@/composables/useWorkspaceResources'
import ReplyArtifacts from '@/components/ReplyArtifacts.vue'
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { finishWindowStartup } from '../utils/window-startup'
import StatusIcon from '@/components/StatusIcon.vue'
import ComposerEditor from '@/components/ComposerEditor.vue'
import type {ComposerSourceInsert} from '@/components/ComposerSourcePicker.vue'
import ApplicationMenuBar from '@/components/ApplicationMenuBar.vue'
import WorkspaceFilePickerDialog from '@/components/WorkspaceFilePickerDialog.vue'
import NativePanelDialog from '@/components/NativePanelDialog.vue'
import BrowserConfirmationDialog from '@/components/BrowserConfirmationDialog.vue'
import BrowserContentDialog from '@/components/BrowserContentDialog.vue'
import type {BrowserPageAddressContext} from '@shared/browser-page-address'
import {chatSearchPanel,readSourcesPanel} from '@shared/native-dialog-panels'
import type {NativePanelAction} from '@shared/native-ui'
import {useComposerDraft} from '@/composables/useComposerDraft'
import {normalizeTaskDeclarations,taskDeclarationsLabel,taskDeclarationsSupported,type TaskDeclarationId} from '@shared/task-declarations'
import {compileComposerDocument,previewComposerDocument,composerDocumentFromLegacy,composerSubmissionKey,composerErrorMessage,mergeComposerDocuments,normalizeComposerDocument,type ComposerDocument,type ComposerContextBlock} from '@shared/composer-document'
import type {AppCommandId,AppCommandContext,AppCommandStateMap} from '@shared/app-commands'
import {captureActiveComposerEditor,type ComposerSelectionBookmark,type ComposerEditorCommand,type ComposerEditorHandle} from '@/editor/composer-editor-registry'
import {useApplicationEditTarget} from '@/composables/useApplicationEditTarget'
import {reasoningLabel} from '@shared/composer-commands'
import ConversationOutline from '@/components/ConversationOutline.vue'
import DisclosureTransition from '@/components/motion/DisclosureTransition'
import { modelCapabilities } from '@shared/model-capabilities'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import type {
  AgentAskRequest,
  AgentPhase,
  BrowserContextRef,
  BrowserTreeSession,
  ChatMessage,
  ChatPermissions,
  ChatSession,
  PermissionDecision,
  PermissionPreset,
  PermissionRequest,
} from '@shared/types'
import {permissionRequestsForChat} from '@shared/permission-request-queue'
import {
  detectPermissionPreset,
  FORK_ASK_TIMEOUT_DEFAULT_MS,
  modesForPreset,
  type AiProviderConfig,
  type AppConfig,
} from '@shared/config'
import {
  followupKey,
  normalizeFollowupList,
  type FollowupSuggestion,
} from '@shared/followups'
import { normalizeProvider, resolveModelName, resolveProvider } from '@shared/model-providers'
import {confirmedModelSelection,type ModelSelectionIdentity} from '@shared/model-selection'
import {estimateContextText} from '@shared/context-budget'
import {normalizeModelUsage} from '@shared/model-usage'
import {browserTabShortcut} from '@shared/browser-workspace'
import ChatMarkdown from '@/components/ChatMarkdown.vue'
import ConversationFind from '@/components/ConversationFind.vue'
import {useWindowFind,openWindowFind,stepWindowFind} from '@/composables/useWindowFind'
import {useAppQuitConfirmation} from '@/composables/useAppQuitConfirmation'
import ComposerAttachmentMenu from '@/components/ComposerAttachmentMenu.vue'
const conversationFind=ref<InstanceType<typeof ConversationFind>|null>(null),conversationFindOpen=ref(false),attachmentMenu=ref<InstanceType<typeof ComposerAttachmentMenu>|null>(null)
const findToolReveal=ref<Record<string,{from:number;to:number}>>({})
const findTemporaryExpansion={tools:new Set<string>(),logs:new Set<string>(),processes:new Set<string>()}
const windowFind=useWindowFind()
async function openConversationFind(){
  if(!activeId.value||!await canLeaveSettings())return
  settingsOpen.value=false;creatorKind.value=null
  await nextTick()
  conversationFind.value?.open()
}
function revealFindConversation(){stickToBottom.value=false;if(conversationIsVisible.value)return;fileManagerMode.value=false;pluginWorkspaceMode.value=false;browserWorkspaceMode.value=false;if(fileWorkspaceOverlay.value)hideFileWorkspace();else if(browserExpanded.value)workspaceConversationActive.value=true}
async function locateFindMessage(id:string,match?:{from:number;to:number}){if(match)findToolReveal.value={...findToolReveal.value,[id]:match};const group=processByMessage.value.get(id);if(group&&!expandedProcesses.value[group.key])findTemporaryExpansion.processes.add(group.key);if(!isActivityExpanded(id)){expandedTools.value={...expandedTools.value,[id]:true};findTemporaryExpansion.tools.add(id)}if(!expandedLogs.value[id]){expandedLogs.value={...expandedLogs.value,[id]:true};findTemporaryExpansion.logs.add(id)}await jumpToMessage(id)}
function restoreFindExpansion(open:boolean){if(open)return;findToolReveal.value={};for(const [state,keys] of [[expandedTools,findTemporaryExpansion.tools],[expandedLogs,findTemporaryExpansion.logs],[expandedProcesses,findTemporaryExpansion.processes]] as const){const next={...state.value};for(const key of keys)delete next[key];state.value=next;keys.clear()}}
import {lazyPanel} from '@/utils/lazy-panel'
const SettingsPage=lazyPanel(()=>import('./SettingsPage.vue'),'设置')
import { useSidebarLayout } from '@/composables/useSidebarLayout'
import { useSidebarPresentation } from '@/composables/useSidebarPresentation'
import SidebarNavigation from '@/components/sidebar/SidebarNavigation.vue'
import GlobalResourcesPanel from '@/components/sidebar/GlobalResourcesPanel.vue'
import ChatResourcesMenu from '@/components/ChatResourcesMenu.vue'
import {browserPageAddressError} from '@shared/browser-page-address'
import {GUIDE_READING_STORAGE_KEY,readGuideReading,resolveGuideTarget} from '@shared/user-guide'
import {hasVisibleUi} from '@/utils/visible-ui'
import {browserViewports} from '@/composables/useBrowserSurfaceLayout'
import WorkspaceLauncher from '@/components/WorkspaceLauncher.vue'
import MessageQueue from '@/components/MessageQueue.vue'
const DocsPage=lazyPanel(()=>import('./DocsPage.vue'),'使用文档')
import SkillReviewHost from '@/components/skills/SkillReviewHost.vue'
import CatalogItemCard from '@/components/store/CatalogItemCard.vue'
import ToolCatalogList from '@/components/store/ToolCatalogList.vue'
import { useStoreUi } from '@/composables/useStoreUi'
import { storeErrorText } from '@shared/store'
import BrowserDownloadsMenu from '@/components/BrowserDownloadsMenu.vue'
import ConversationResourcesCard from '@/components/ConversationResourcesCard.vue'
import {useConversationResources} from '@/composables/useConversationResources'
import {useResourceCardLayout} from '@/composables/useResourceCardLayout'
import {useFileTabs} from '@/composables/useFileTabs'
import {useFileWorkspaceLayout} from '@/composables/useFileWorkspaceLayout'
import FileWorkspace from '@/components/FileWorkspace.vue'
import type {QuestionnaireRecord} from '@shared/questionnaire'
import {OPEN_QUESTIONNAIRE_EVENT,type OpenQuestionnaireRequest} from '@/utils/questionnaire-events'
import FileManager from '@/components/FileManager.vue'
const PluginWorkspace=lazyPanel(()=>import('@/components/plugins/PluginWorkspace.vue'),'插件')
const CreatorWorkspace=lazyPanel(()=>import('@/components/CreatorWorkspace.vue'),'创建器')
import type { CreatorKind } from '@shared/creators'
import SidebarDock from '@/components/sidebar/SidebarDock.vue'
import SidebarPresentationIcon from '@/components/icons/SidebarPresentationIcon.vue'
import { useSidebarDock } from '@/composables/useSidebarDock'
import SidebarContextMenu from '@/components/sidebar/SidebarContextMenu.vue'
import InChatAskCard from '@/components/chat/InChatAskCard.vue'
import {submitDecision,deferDecisionCancellation,isDecisionSubmitting,type DecisionSubmissionStates} from '@shared/decision-submission'
import {clearDecisionDraft} from '@/composables/useDecisionDraft'
import InChatPermCard from '@/components/chat/InChatPermCard.vue'
import { useMobileLayout } from '@/composables/useMobileLayout'
import {
  extractImagePathFromToolResult,
  resolveWorkspaceMediaUrl,
  revokeAllMediaUrls,
  revokeMediaUrlsForChat,
} from '@/utils/chat-media'
import {
  faviconForUrl,
  makeSnippet,
  parseSourcesFromMarkdown,
  siteNameFromUrl,
  stripTrailingSourcesSection,
  type AnswerSource,
} from '@shared/answer-sources'
import {
  logKindFromMeta,
  logKindLabel,
  resolveRunLogView,
  type LogKindTone,
} from '@shared/run-logs'
import {
  resolveToolDisplay,
  type ToolDisplayInfo,
} from '@shared/tool-display'
import {
  formatChatExportContent,
  suggestChatExportFilename,
} from '@shared/export-chat'
import { isWebRemote } from '@/remote-api'

const router = useRouter()
const route = useRoute()
const { isMobileLayout } = useMobileLayout()
const showDesktopChrome = computed(
  () => Boolean(window.navora?.app?.nativeTitleBar) && !isWebRemote(),
)
const windowPlatform = window.navora?.app?.platform || 'web'
const browserResources = ref<{ quickOpen: () => Promise<void> } | null>(null)
type PageActionHost={refresh?:()=>unknown;manage?:()=>unknown;save?:()=>unknown;export?:()=>unknown;requestClose?:()=>Promise<boolean>;canClose?:()=>Promise<boolean>;runAction?:(action:string)=>unknown}
const settingsWorkspace=ref<PageActionHost|null>(null),fileManagerWorkspace=ref<{refresh:()=>unknown;openFolder:()=>unknown}|null>(null),pluginsWorkspace=ref<PageActionHost|null>(null),creatorWorkspace=ref<PageActionHost|null>(null)
let leavingSettings:Promise<boolean>|undefined
async function canLeaveSettings(){if(!settingsOpen.value)return true;if(leavingSettings)return leavingSettings;const host=settingsWorkspace.value;leavingSettings=Promise.resolve(host?.canClose?.()??host?.runAction?.('canClose')).then(result=>result===true);try{return await leavingSettings}finally{leavingSettings=undefined}}
onBeforeRouteLeave(()=>canLeaveSettings())
const pageContext=computed(()=>creatorKind.value?'creator':settingsOpen.value?'settings':pluginWorkspaceActive.value?'plugins':fileManagerActive.value?'files':browserWorkspaceActive.value?'browser':'chat')
async function toggleRightSidebar(){
  if(!await canLeaveSettings())return
  const wasVisible=fileWorkspaceVisible.value
  const hadTabs=fileTabsState.value.tabs.length>0
  const restoreFocus=document.activeElement instanceof HTMLElement&&document.activeElement.dataset.chatResource==='workspace'
  settingsOpen.value=false;creatorKind.value=null;pluginWorkspaceMode.value=false;fileManagerMode.value=false;browserWorkspaceMode.value=false
  if(wasVisible)hideFileWorkspace()
  else{
    showFileWorkspace()
    if(hadTabs&&restoreFocus)void nextTick(()=>document.querySelector<HTMLButtonElement>('.file-workspace .workspace-launcher')?.focus({preventScroll:true}))
  }
}
function hideWorkspace(){hideFileWorkspace();if(browserWorkspaceActive.value)activateSidebar('chats',false)}
async function onPageAction(action:string){
  const context=pageContext.value
  if(context==='settings'&&(action==='back'||action==='plugins'||action==='create-skill')&&!await canLeaveSettings())return
  if(action==='back'){if(creatorKind.value){closeCreator();return}if(settingsOpen.value){await completeSettingsReturn();return}activateSidebar('chats',false);return}
  if(context==='settings'){if(action==='models')settingsTab.value='model';else if(action==='plugins'){settingsOpen.value=false;activateSidebar('plugins',false)}else if(action==='create-skill')openCreator('skill')}
  else if(context==='browser'){if(action==='new-browser')openBrowserTab()}
  else if(context==='files'){if(action==='refresh')fileManagerWorkspace.value?.refresh();else if(action==='folder')fileManagerWorkspace.value?.openFolder()}
  else if(context==='plugins'){if(action==='refresh')void pluginsWorkspace.value?.refresh?.();else if(action==='manage')pluginsWorkspace.value?.manage?.();else if(action==='create')openCreator('plugin')}
  else if(context==='creator'){if(action==='save')void creatorWorkspace.value?.save?.();else if(action==='export')void creatorWorkspace.value?.export?.()}
}

const executionModes = [
  { id: 'auto' as const, icon:'wand-magic-sparkles', label: '自动', hint: '按问题选择问答或工具' },
  { id: 'chat' as const, icon:'comments', label: '快速问答', hint: '直接回复，不访问浏览器与文件' },
  { id: 'agent' as const, icon:'robot', label: '执行任务', hint: '浏览器、工作区与插件' },
]
const executionModeIcon=computed(()=>executionModes.find(m=>m.id===(active.value?.executionMode||'auto'))?.icon||'wand-magic-sparkles')
const executionModeLabel = computed(() => executionModes.find(m => m.id === (active.value?.executionMode || 'auto'))?.label || '自动')
async function applyExecutionMode(mode: 'auto' | 'chat' | 'agent') {
  if (!window.navora || !activeId.value || agentRunning.value || sending.value || executionModeBusy.value || modelSelectionBusy.value) return
  executionModeBusy.value=true
  const chatId=activeId.value
  try {
    const chat = await window.navora.chats.setExecutionMode(chatId, mode)
    if (chat && activeId.value===chatId) active.value = chat
    await refreshList()
  } catch (error) { showToast(error instanceof Error ? error.message : '切换模式失败') } finally {executionModeBusy.value=false}
}
function onAppShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.repeat || settingsOpen.value&&!docsOpen.value || hasVisibleUi('.v-dialog.v-overlay--active,.v-menu.v-overlay--active,.sidebar-ctx-panel:not([data-browser-tab-preview])')) return
  const key = event.key.toLowerCase()
  if(docsOpen.value){if((event.ctrlKey||event.metaKey)&&key==='f'&&!event.shiftKey){event.preventDefault();docsWorkspace.value?.runAction('focusSearch')}return}
  if(browserExpanded.value&&fileWorkspaceVisible.value&&!(event.target instanceof Element&&event.target.closest('.file-workspace'))){const action=browserTabShortcut({key:event.key,control:event.ctrlKey,meta:event.metaKey,shift:event.shiftKey});if(action&&(['next','previous','last','close'].includes(action)||action.startsWith('index'))){event.preventDefault();void fileWorkspace.value?.shortcut(action);return}}
  if(key==='f3'&&windowFind.opened.value){event.preventDefault();void stepWindowFind(event.shiftKey?-1:1);return}
  if((event.ctrlKey||event.metaKey)&&key==='f'&&!event.shiftKey&&!(event.target instanceof Element&&event.target.closest('.file-workspace,.browser-tab-panel'))){event.preventDefault();if(!conversationIsVisible.value&&openWindowFind('workspace'))return;void openConversationFind();return}
  if (event.ctrlKey || event.metaKey) {
    if (key === 't' && event.shiftKey && activeId.value && !isWebRemote()) { event.preventDefault(); void window.navora!.browser.workspace.tabAction({chatId:activeId.value,action:'reopen'}).catch(()=>showToast('当前对话没有可恢复的标签页。')) }
    else if (key === 't' && !event.shiftKey && activeId.value && !browserWorkspaceActive.value) { event.preventDefault(); openBrowserTab(); settingsOpen.value=false; creatorKind.value=null; pluginWorkspaceMode.value=false; fileManagerMode.value=false }
    else if (key === 'b' && event.shiftKey) { event.preventDefault(); void browserResources.value?.quickOpen() }
    else if(key==='w'&&!event.shiftKey&&activeFileTab.value&&fileWorkspaceVisible.value){event.preventDefault();void closeFileTab(activeFileTab.value.key)}
  }
}

const DND_MIME = 'application/x-navora-browser-ref'

const PERM_LABELS: Record<string, string> = {
  'session.create': '创建 Session',
  'session.persist': '持久化 Session',
  'session.close': '关闭 Session',
  'session.clear': '清空 Session 数据',
  'session.set_proxy': '设置代理',
  'session.set_ua': '设置 UA',
  'session.cookies_read': '读取 Cookies',
  'session.cookies_write': '写入 Cookies',
  'session.fetch': 'Session 网络请求',
  'window.create': '创建窗口',
  'window.close': '关闭窗口',
  'window.set_visible': '显示/隐藏窗口',
  navigate: '页面导航',
  wait: '等待页面条件',
  click: '点击元素',
  type: '输入文本',
  get_page: '读取页面内容',
  evaluate: '执行页面脚本',
  screenshot: '页面截图',
  'desktop.screenshot': '桌面截图',
  'network.request': '独立网络请求',
  'network.observe': '观察网络请求',
  'network.modify': '修改网络请求',
  'network.block': '拦截网络请求',
  'file.read': '读取文件',
  'file.write': '写入/删除文件',
  'file.download': '主动文件下载',
  'file.download.passive': '被动文件下载',
  'shell.open': '打开文件/资源管理器',
  'shell.exec': '执行系统命令',
  'settings.read': '查看软件设置',
  'settings.write': '修改软件设置',
  'skills.write': '添加/编辑技能',
  'browser.geolocation': '获取位置',
  'compute.local': '本地计算',
}

const chats = ref<ChatSession[]>([])
let nativeRowMenuEpoch=0
onBeforeUnmount(()=>{nativeRowMenuEpoch++})
onBeforeRouteLeave(()=>{nativeRowMenuEpoch++;pageCtxMenu.value?.hide()})
const activeId = ref<string | null>(null)
const active = ref<ChatSession | null>(null)
const tree = ref<BrowserTreeSession[]>([])
const windowCounts = ref<Record<string, number>>({})
const draftState=useComposerDraft(activeId,message=>showToast(message,'warning'))
const {document:composerDocument,text:draft,refs:contextRefs,conflict:draftConflict,unsupported:draftUnsupported}=draftState
const maxComposerChars = ref(16000)
const agentRunning = ref(false)
const sending = ref(false)
const retrying = ref(false)
const modelQuery = ref('')
const modelSelectionBusy = ref(false),executionModeBusy=ref(false),modelLoading=ref(false),modelLoadError=ref('')
const permMenuOpen = ref(false)
const modelMenuOpen = ref(false)
const usageMenuOpen = ref(false)
const docsOpen=ref(false)
const modeMenuOpen=ref(false),composerMenuBoundary=ref<HTMLElement>()
function placeComposerMenus(){
  const host=composerMenuBoundary.value,composer=document.querySelector<HTMLElement>('.composer-box')
  if(!host||!composer)return
  const rect=composer.getBoundingClientRect(),main=composer.closest('.main')?.getBoundingClientRect()
  Object.assign(host.style,{left:`${rect.left+8}px`,top:`${(main?.top||0)+8}px`,width:`${Math.max(0,rect.width-16)}px`,height:`${Math.max(0,(main?.bottom||innerHeight)-(main?.top||0)-16)}px`})
}
watch([modeMenuOpen,permMenuOpen,modelMenuOpen,usageMenuOpen],()=>{placeComposerMenus();void nextTick(placeComposerMenus)},{flush:'sync'})
watch(activeId,()=>{modeMenuOpen.value=false;permMenuOpen.value=false;modelMenuOpen.value=false;usageMenuOpen.value=false})
onMounted(()=>window.addEventListener('resize',placeComposerMenus))
onBeforeUnmount(()=>window.removeEventListener('resize',placeComposerMenus))
const settingsPermissions = ref<ChatPermissions | null>(null)
const aiProviders = ref<AiProviderConfig[]>([])
const aiDefaultProviderId = ref('')
const providerKeyOk = ref<Record<string, boolean>>({})
const runningChats = ref<Record<string, boolean>>({})
const chatErrors = ref<Record<string, { message: string; code?: string }>>({})
const chatSwipeOpenId = ref<string | null>(null)
const chatMoreOpenId = ref<string | null>(null)
const renamingChatId = ref<string | null>(null)
const renameDraft = ref('')
const renameInputEls = new Map<string, HTMLInputElement>()
let renameCommitLock = false
/** Ignore blur while menu closes / focus settles after starting rename. */
let renameIgnoreBlurUntil = 0
const chatSwipeDragId = ref<string | null>(null)
const chatSwipeOffset = ref(0)
const chatSwipeLockedH = ref(false)
const CHAT_SWIPE_ACTION_W = 76
let chatSwipeStartX = 0
let chatSwipeStartY = 0
let chatSwipeBaseOffset = 0
let chatSwipeAxis: 'h' | 'v' | null = null
let chatSwipeSuppressClick = false
let chatSwipeSuppressTimer: ReturnType<typeof setTimeout> | undefined
const phase = ref<AgentPhase>('idle')
const phaseDetail = ref('')
const runStartedAt = ref(0)
const nowTick = ref(Date.now())

const dropActive = ref(false)
const msgBox = ref<HTMLElement | null>(null)
const draftField = ref<InstanceType<typeof ComposerEditor> | null>(null)
const stickToBottom = ref(true)
const showJumpBottom = ref(false)
const toolMediaSrc = ref<Record<string, string>>({})
const lightbox = ref<{ src: string; alt: string }>({ src: '', alt: '' })
const pendingPermRequests = ref<PermissionRequest[]>([])
const visiblePermRequests = computed(() => permissionRequestsForChat(pendingPermRequests.value,activeId.value,chats.value))
const permReq = computed(() => visiblePermRequests.value[0] || null)
const permPendingCount = computed(() => visiblePermRequests.value.length)
const decisionSubmissions=reactive<DecisionSubmissionStates>({})
const permBusyId=computed(()=>permReq.value&&decisionSubmissions[permReq.value.id]?.pending?permReq.value.id:'')
const askBusy=computed(()=>!!activePendingAsk.value&&!!decisionSubmissions[activePendingAsk.value.id]?.pending)
const permCapabilityLabel = computed(
  () => PERM_LABELS[permReq.value?.capability || ''] || permReq.value?.capability || '权限确认',
)
const deleteDialog = ref(false)
const deleteTarget = ref<ChatSession | null>(null)
const deleteBatchIds = ref<string[] | null>(null)
const deleting = ref(false)
const chatBatchMode = ref(false)
const batchSelectedIds = ref<Set<string>>(new Set())
const batchPinning = ref(false)
const batchSelectedCount = computed(() => batchSelectedIds.value.size)
const batchAllSelected = computed(() => {
  const mains = chats.value.filter((c) => c.kind !== 'sub')
  return mains.length > 0 && batchSelectedIds.value.size >= mains.length
})
const batchSelectionAllPinned = computed(() => {
  if (!batchSelectedIds.value.size) return false
  const byId = new Map(chats.value.map((c) => [c.id, c]))
  for (const id of batchSelectedIds.value) {
    if (!byId.get(id)?.pinned) return false
  }
  return true
})

type ChatListSection = { key: string; label: string; items: ChatSession[] }

function chatDateBucket(ts: number, now = new Date()): { key: string; label: string } {
  const d = new Date(ts)
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayMs = 86_400_000
  if (startDay === startToday) return { key: 'today', label: '今天' }
  if (startDay === startToday - dayMs) return { key: 'yesterday', label: '昨天' }
  if (d.getFullYear() === now.getFullYear()) {
    return {
      key: `d-${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
      label: `${d.getMonth() + 1}月${d.getDate()}日`,
    }
  }
  return {
    key: `m-${d.getFullYear()}-${d.getMonth()}`,
    label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
  }
}

const chatListSections = computed((): ChatListSection[] => {
  const pinned: ChatSession[] = []
  const rest: ChatSession[] = []
  for (const c of chats.value) {
    // Agent-spawned sub-chats stay out of the primary sidebar (shown under active parent).
    if (c.kind === 'sub') continue
    if (c.pinned) pinned.push(c)
    else rest.push(c)
  }
  const sections: ChatListSection[] = []
  if (pinned.length) sections.push({ key: 'pinned', label: '置顶', items: pinned })
  const seen = new Map<string, ChatListSection>()
  for (const c of rest) {
    const b = chatDateBucket(c.updatedAt)
    let sec = seen.get(b.key)
    if (!sec) {
      sec = { key: b.key, label: b.label, items: [] }
      seen.set(b.key, sec)
      sections.push(sec)
    }
    sec.items.push(c)
  }
  return sections
})

const CHAT_LIST_INITIAL_LIMIT = 60
const CHAT_LIST_PAGE_SIZE = 60
const chatListLimit = ref(CHAT_LIST_INITIAL_LIMIT)

const visibleChatListSections = computed((): ChatListSection[] => {
  const sections = chatListSections.value
  const total = sections.reduce((sum, section) => sum + section.items.length, 0)
  let offset = 0
  let activeIndex = -1
  for (const section of sections) {
    const localIndex = section.items.findIndex((chat) => chat.id === activeId.value)
    if (localIndex >= 0) {
      activeIndex = offset + localIndex
      break
    }
    offset += section.items.length
  }
  const limit = chatBatchMode.value ? total : Math.max(chatListLimit.value, activeIndex + 1)
  let remaining = Math.min(total, limit)
  return sections.flatMap((section) => {
    if (remaining <= 0) return []
    const items = section.items.slice(0, remaining)
    remaining -= items.length
    return items.length ? [{ ...section, items }] : []
  })
})

const chatListRemainingCount = computed(() =>
  Math.max(0, chatListSections.value.reduce((sum, section) => sum + section.items.length, 0)
    - visibleChatListSections.value.reduce((sum, section) => sum + section.items.length, 0)),
)

function loadMoreChats() {
  chatListLimit.value += CHAT_LIST_PAGE_SIZE
}

const subchatsByParent = computed(() => {
  const map = new Map<string, ChatSession[]>()
  for (const c of chats.value) {
    if (c.kind !== 'sub' || !c.parentChatId) continue
    const list = map.get(c.parentChatId)
    if (list) list.push(c)
    else map.set(c.parentChatId, [c])
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt)
  }
  return map
})

function subchatsOf(parentId: string): ChatSession[] {
  return subchatsByParent.value.get(parentId) || []
}

function subchatCountOf(parentId: string): number {
  return subchatsOf(parentId).length
}


const DEFAULT_CHAT_TITLE = '新对话'

function normalizeTitleText(s?: string | null): string {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortenTitle(s?: string | null, max = 28): string {
  const t = normalizeTitleText(s)
  if (!t) return ''
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1))}…`
}

function displayChatTitle(title?: string | null): string {
  const t = normalizeTitleText(title)
  if (!t || /^新\s*Chat$/i.test(t)) return DEFAULT_CHAT_TITLE
  return t
}

function displaySubchatTitle(c: ChatSession): string {
  const titled = displayChatTitle(c.title)
  if (titled && titled !== DEFAULT_CHAT_TITLE) return titled
  return normalizeTitleText(c.spawnPurpose || '') || DEFAULT_CHAT_TITLE
}

/** Full goal / title for native tooltip (sidebar + header). */
function subchatTitleTooltip(c: ChatSession | null | undefined): string {
  if (!c) return ''
  const purpose = normalizeTitleText(c.spawnPurpose || '')
  if (purpose) return purpose
  return displaySubchatTitle(c)
}

/** Label for sessions owned by a sub-chat when shown under the parent resource panel. */
function treeOwnerLabel(chatId: string): string {
  const c = chats.value.find((x) => x.id === chatId)
  if (!c) return '子任务'
  return shortenTitle(displaySubchatTitle(c), 16) || '子任务'
}

const closeSessionDialog = ref(false)
const closeSessionTarget = ref<BrowserTreeSession | null>(null)
const closingSession = ref(false)
const quitConfirmation=useAppQuitConfirmation()
const {open:quitDialog,runningAgents:quitRunningAgents,checking:quitChecking,error:quitStateError,ready:quitReady,message:quitMessage}=quitConfirmation
const quitting = ref(false)
const exportingChat = ref(false)
const {open:resourceOpen,tab:resourceTab,updated:resourceUpdated,updateCount:resourceUpdateCount,reading:resourceReading,show:showResources,close:hideResources} = useConversationResources(activeId,tree)
function closeResources(){hideResources()}
function toggleResources(){if(resourceOpen.value)closeResources();else showResources('overview')}
const {current:fileTabsState,active:activeFileTab,open:openFileTab,openBrowser:openBrowserTabBase,openSubchats:openSubchatWorkspaceTab,openQuestionnaire:openQuestionnaireWorkspaceTab,updateQuestionnaire:updateQuestionnaireWorkspaceTab,selectSubchat:selectWorkspaceSubchat,updateBrowser:updateBrowserTab,syncBrowser:syncBrowserTabs,presentResource:presentBrowserResource,reorder:reorderBrowserTab,select:selectFileTabBase,close:closeFileTabBase,hide:hideFileWorkspaceBase,show:showFileWorkspace,removeOwner:removeFileOwner,transfer:transferFileTab,resolveBrowser:resolveBrowserTab}=useFileTabs(activeId,onPanelNotify)
const questionnaireRecords=ref<Record<string,QuestionnaireRecord>>({})
let unsubscribeQuestionnaires:(()=>void)|undefined,questionnaireOpenRevision=0
function questionnaireBelongsTo(record:QuestionnaireRecord,chatId:string){return record.chatId===chatId||record.parentChatId===chatId||chats.value.some(chat=>chat.id===record.chatId&&chat.parentChatId===chatId)}
const activeQuestionnaires=computed(()=>Object.values(questionnaireRecords.value).filter(record=>record.status==='pending'&&!!activeId.value&&questionnaireBelongsTo(record,activeId.value)).sort((a,b)=>Number(b.chatId===activeId.value)-Number(a.chatId===activeId.value)||a.createdAt-b.createdAt))
const activeOwnQuestionnaire=computed(()=>activeQuestionnaires.value.find(record=>record.chatId===activeId.value))
const questionnaireDocks=computed(()=>activeQuestionnaires.value.filter(record=>!fileWorkspaceVisible.value||workspaceConversationActive.value||activeFileTab.value?.kind!=='questionnaire'||activeFileTab.value.questionnaireId!==record.id))
function pendingQuestionnaireForSidebar(chatId:string){return Object.values(questionnaireRecords.value).find(record=>record.status==='pending'&&questionnaireBelongsTo(record,chatId))}
function acceptQuestionnaireRecord(record:QuestionnaireRecord,autoOpen=false){
  const previous=questionnaireRecords.value[record.id]
  if(previous&&(previous.updatedAt>record.updatedAt||(previous.status!=='pending'&&record.status==='pending')))return
  questionnaireRecords.value={...questionnaireRecords.value,[record.id]:record}
  updateQuestionnaireWorkspaceTab(record)
  if(autoOpen&&!previous&&record.status==='pending'&&record.chatId===activeId.value&&!settingsOpen.value&&!creatorKind.value&&!fileManagerActive.value&&!pluginWorkspaceActive.value&&!browserWorkspaceActive.value&&activeFileTab.value?.kind!=='questionnaire')void openQuestionnaireRecord(record)
}
async function refreshQuestionnaires(){
  const api=window.navora?.questionnaires
  if(!api)return
  try{for(const record of await api.list())acceptQuestionnaireRecord(record)}catch{showToast('暂时无法读取问卷，稍后可重新打开。','warning')}
}
async function flushQuestionnaireDraft(){return await fileWorkspace.value?.flushQuestionnaireDraft()??true}
async function openQuestionnaireRecord(input:QuestionnaireRecord|string){
  const revision=++questionnaireOpenRevision,api=window.navora?.questionnaires
  if(!api)return
  try{
    const record=typeof input==='string'?await api.get(input):input
    if(revision!==questionnaireOpenRevision)return
    if(!record){showToast('问卷已不存在。','warning');return}
    if(!await canLeaveSettings()||!await flushQuestionnaireDraft()||revision!==questionnaireOpenRevision)return
    const owner=chats.value.find(chat=>chat.id===record.chatId)||await window.navora!.chats.get(record.chatId)
    if(!owner||revision!==questionnaireOpenRevision){if(!owner)showToast('所属对话已删除。','warning');return}
    const viewer=owner.kind==='sub'&&owner.parentChatId?owner.parentChatId:owner.id
    if(activeId.value!==viewer)await selectChat(viewer)
    if(revision!==questionnaireOpenRevision||activeId.value!==viewer)return
    settingsOpen.value=false;creatorKind.value=null;fileManagerMode.value=false;pluginWorkspaceMode.value=false;browserWorkspaceMode.value=false
    acceptQuestionnaireRecord(record);workspaceConversationActive.value=false
    if(openQuestionnaireWorkspaceTab(record)){if(fileWorkspaceOverlay.value)hideResources();if(isMobileLayout.value)closeMobileSidebar()}
  }catch{showToast('无法打开问卷，填写内容会继续保留。','warning')}
}
function onOpenQuestionnaireEvent(event:Event){const detail=(event as CustomEvent<OpenQuestionnaireRequest>).detail;if(detail&&typeof detail.id==='string'&&typeof detail.chatId==='string')void openQuestionnaireRecord(detail.id)}
async function onQuestionnaireReturnToChat(target:{chatId:string;questionnaireId:string}){
  if(!await flushQuestionnaireDraft())return
  if(target.chatId!==activeId.value){await routeConversationTarget(target.chatId);await nextTick();document.querySelector<HTMLElement>('.subchat-composer [contenteditable="true"]')?.focus();return}
  if(fileWorkspaceOverlay.value)await hideFileWorkspace()
  else if(browserExpanded.value)workspaceConversationActive.value=true
  await nextTick();focusComposer()
}
async function closeFileTab(key:string){if(activeFileTab.value?.key===key&&activeFileTab.value.kind==='questionnaire'&&!await flushQuestionnaireDraft())return;await closeFileTabBase(key)}
async function hideFileWorkspace(){if(activeFileTab.value?.kind==='questionnaire'&&!await flushQuestionnaireDraft())return;hideFileWorkspaceBase()}
const pluginWorkspaceMode=ref(false),pluginWorkspaceMounted=ref(false),browserWorkspaceMode=ref(false)
const fileWorkspaceVisible=computed(()=>fileTabsState.value.open&&!settingsOpen.value&&!creatorKind.value&&!pluginWorkspaceMode.value&&!browserWorkspaceMode.value&&!docsOpen.value)
async function openBrowserTab(afterKey?:string){if(!activeId.value||!await flushQuestionnaireDraft())return;workspaceConversationActive.value=false;await openBrowserTabBase(afterKey)}
async function selectFileTab(key:string){if(activeFileTab.value?.key!==key&&!await flushQuestionnaireDraft())return;workspaceConversationActive.value=false;selectFileTabBase(key)}
async function openSubchatList(){if(activeId.value&&await flushQuestionnaireDraft()){workspaceConversationActive.value=false;openSubchatWorkspaceTab(activeId.value)}}
let subchatTargetRevision=0
async function routeConversationTarget(chatId:string){
  const revision=++subchatTargetRevision
  if(!window.navora||!await canLeaveSettings()||!await flushQuestionnaireDraft())return
  const child=chats.value.find(chat=>chat.id===chatId)||await window.navora.chats.get(chatId)
  if(revision!==subchatTargetRevision)return
  if(!child){showToast('子对话记录已删除。','warning');return}
  if(child.kind!=='sub'||!child.parentChatId){await selectChat(child.id);return}
  const parentId=child.parentChatId
  if(activeId.value!==parentId)await selectChat(parentId)
  if(revision!==subchatTargetRevision||activeId.value!==parentId)return
  settingsOpen.value=false;creatorKind.value=null;fileManagerMode.value=false;pluginWorkspaceMode.value=false;browserWorkspaceMode.value=false
  workspaceConversationActive.value=false;openSubchatWorkspaceTab(parentId,child.id)
}
async function locateSubchatParent(target:{chatId:string;toolCallId?:string}){
  if(activeId.value!==target.chatId)await selectChat(target.chatId)
  if(activeId.value!==target.chatId)return
  if(browserExpanded.value)workspaceConversationActive.value=true
  const message=target.toolCallId?active.value?.messages.find(message=>message.meta?.toolCallId===target.toolCallId):undefined
  if(message){await nextTick();await jumpToMessage(message.id)}
}
const subchatSignals=useSubchatSignals(computed(()=>activeId.value||''))
const manualBrowserExpanded=ref(false),workspaceConversationActive=ref(false),fileWorkspace=ref<InstanceType<typeof FileWorkspace>|null>(null)
const workspaceViews=new Map<string,{expanded:boolean;conversation:boolean}>()
watch(activeId,(id,previous)=>{if(previous)workspaceViews.set(previous,{expanded:manualBrowserExpanded.value,conversation:workspaceConversationActive.value});const saved=id?workspaceViews.get(id):undefined;manualBrowserExpanded.value=saved?.expanded||false;workspaceConversationActive.value=saved?.conversation||false},{flush:'sync'})
watch(()=>fileTabsState.value.tabs.length,count=>{if(!count){manualBrowserExpanded.value=false;workspaceConversationActive.value=false}})
function toggleBrowserExpand(){if(!toggleWorkspaceExpanded())showToast('当前窗口宽度不足以显示分栏。','info');workspaceConversationActive.value=false}
function toggleWorkspaceTabExpanded(target:'conversation'|'workspace'){if(!toggleWorkspaceExpanded())showToast('当前窗口宽度不足以显示分栏。','info');workspaceConversationActive.value=target==='conversation'}
function showWorkspaceConversation(){workspaceConversationActive.value=true}
const workspaceToolsTarget=ref<HTMLElement|null>(null)
const workspaceHeaderActive=computed(()=>fileWorkspaceVisible.value&&browserExpanded.value&&!browserWorkspaceActive.value)
function restoreConversationSplit(){if(!requestWorkspaceSplit())showToast('扩大窗口后即可恢复分栏。','info');workspaceConversationActive.value=false}
function onWorkspaceChatToolKey(event:KeyboardEvent){if(event.isComposing||event.keyCode===229)return;if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();void openConversationFind()}}
const previewWidth = ref(400)
const mainElement=ref<HTMLElement|null>(null)
const { layout: sidebarLayout, style: sidebarStyle, resizing: sidebarResizing, maxWidth: sidebarWidthMaximum, beginResize: beginSidebarResize, resizeKey: sidebarResizeKey } = useSidebarLayout()
const {mainWidth:fileWorkspaceMainWidth,overlay:fileWorkspaceOverlay,expanded:browserExpanded,automatic:workspaceExpansionReason,expandPreview:workspaceExpandPreview,conversationPreview:workspaceConversationPreview,maximum:fileWorkspaceMaximum,width:fileWorkspaceWidth,reserve:fileWorkspaceReserve,resize:resizeFileWorkspaceBase,requestSplit:requestWorkspaceSplit,toggleExpanded:toggleWorkspaceExpanded}=useFileWorkspaceLayout(mainElement,fileWorkspaceVisible,isMobileLayout,manualBrowserExpanded,activeId)
function resizeFileWorkspace(value:number,phase:'preview'|'commit'|'cancel'='commit'){const target=resizeFileWorkspaceBase(value,phase);if(target)workspaceConversationActive.value=target==='conversation'}
const {overlay:resourceOverlay,availableWidth:resourceAvailableWidth}=useResourceCardLayout(mainElement,previewWidth,isMobileLayout,fileWorkspaceReserve)
try { const saved = Number(localStorage.getItem('navora.preview.width')); if (saved >= 280 && saved <= 800) previewWidth.value = saved } catch { /* optional persistence */ }
watch(fileWorkspaceVisible,async()=>{const follow=stickToBottom.value;await nextTick();if(follow)void scrollMessages(true)})
function setPreviewWidth(width: number) {
  previewWidth.value = width
  try { localStorage.setItem('navora.preview.width', String(width)) } catch { /* optional persistence */ }
}
async function openFilePreview(path: string, chatId = activeId.value) {
  if (!chatId||!await flushQuestionnaireDraft()) return
  try { openFileTab(chatId,path);workspaceConversationActive.value=false } catch(error) { onPanelNotify(error instanceof Error?error.message:'无法打开文件');return }
  if(browserWorkspaceActive.value)activateSidebar('chats',false)
  if(fileWorkspaceOverlay.value)hideResources()
  if (isMobileLayout.value) closeMobileSidebar()
}
const creatorKind = ref<CreatorKind | null>(null)
let creatorReturnToSettings = false
async function openCreator(kind: CreatorKind) {
  if(!await canLeaveSettings())return
  creatorReturnToSettings = settingsOpen.value
  settingsOpen.value = false
  creatorKind.value = kind
  closeMobileSidebar()
}
function closeCreator() { creatorKind.value = null; if (creatorReturnToSettings) settingsOpen.value = true }
async function openCreatorTrial(result: { chatId: string; prompt: string }) {
  creatorKind.value = null
  settingsOpen.value = false
  activateSidebar('chats',false)
  await refreshList()
  await selectChat(result.chatId)
  applyDraftLocally(result.prompt,Date.now())
  scheduleDraftSave()
}
const settingsTab = ref('basic')
const settingsOpen = ref(false)
const browserSettingsFocusPending=ref(false)
type SettingsSourceSnapshot={chatId:string|null;tabKey?:string;expanded:boolean;conversation:boolean;sidebar:string;focus:HTMLElement|null;target?:ApplicationTarget;scrolls:{element:HTMLElement;top:number;left:number}[];label:string;context:string}
let settingsSourceSnapshot:SettingsSourceSnapshot|undefined,settingsReturnId='',settingsNavigationEpoch=0
const settingsReturnLabel=ref('返回进入设置前的内容（Alt ←）')
function captureSettingsSource(target?:ApplicationTarget){
  const label=browserWorkspaceActive.value?'浏览器':fileManagerActive.value?'文件':pluginWorkspaceActive.value?'插件':'对话'
  if(target?.kind==='standard'&&target.bookmark.kind==='editable'&&target.bookmark.target.el instanceof HTMLInputElement&&target.bookmark.target.el.type==='password')target=undefined
  settingsSourceSnapshot={chatId:activeId.value,tabKey:fileWorkspaceVisible.value||browserWorkspaceActive.value?activeFileTab.value?.key:undefined,expanded:manualBrowserExpanded.value,conversation:workspaceConversationActive.value,sidebar:sidebarRail.value.active,focus:document.activeElement instanceof HTMLElement?document.activeElement:null,target,scrolls:[...document.querySelectorAll<HTMLElement>('.messages,.preview-content,.file-manager-list,.plugin-detail-scroll,.plugin-results')].filter(element=>element.checkVisibility()).map(element=>({element,top:element.scrollTop,left:element.scrollLeft})),label,context:pageContext.value}
  settingsReturnLabel.value=`返回${label}（Alt ←）`
}
watch(settingsOpen,open=>{if(!open){browserSettingsFocusPending.value=false;if(settingsReturnId){void window.navora?.app.returnFromSettings(settingsReturnId,false).catch(()=>{});settingsReturnId=''}settingsSourceSnapshot=undefined}})
async function openSettings(section?:string,source?:{target?:ApplicationTarget;returnId?:string}){
  if(docsOpen.value)await closeDocsPage();else ++docsNavigation
  if(document.querySelector('.v-dialog.v-overlay--active')){showToast('请先完成当前窗口中的对话框。','warning');return}
  if(settingsOpen.value&&section&&settingsTab.value!==section&&!await canLeaveSettings())return false
  ++settingsNavigationEpoch
  if(!settingsOpen.value)captureSettingsSource(source?.target)
  if(section)settingsTab.value=section
  if(source?.returnId&&!settingsReturnId)settingsReturnId=source.returnId
  settingsOpen.value=true;browserSettingsFocusPending.value=true
  return true
}
async function toggleSettings(){if(docsOpen.value){await closeDocsPage();if(!settingsOpen.value)await openSettings();return}if(settingsOpen.value){if(await canLeaveSettings())await completeSettingsReturn()}else await openSettings()}
async function completeSettingsReturn(){
  const snapshot=settingsSourceSnapshot,ticket=settingsReturnId,epoch=++settingsNavigationEpoch
  settingsSourceSnapshot=undefined;settingsReturnId=''
  if(!settingsOpen.value)return
  const sameSource=!!snapshot&&snapshot.chatId===activeId.value
  if(sameSource){
    manualBrowserExpanded.value=snapshot.expanded;workspaceConversationActive.value=snapshot.conversation
    sidebarRail.value.active=snapshot.sidebar
    if(snapshot.tabKey&&fileTabsState.value.tabs.some(tab=>tab.key===snapshot.tabKey)&&activeFileTab.value?.key!==snapshot.tabKey)selectFileTabBase(snapshot.tabKey)
  }
  settingsOpen.value=false
  await nextTick()
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(epoch!==settingsNavigationEpoch||settingsOpen.value)return
    if(sameSource&&snapshot&&pageContext.value===snapshot.context){
      for(const saved of snapshot.scrolls)if(saved.element.isConnected&&saved.element.checkVisibility()){saved.element.scrollTop=saved.top;saved.element.scrollLeft=saved.left}
      const target=snapshot.target
      const native=target?.kind==='standard'&&target.bookmark.kind==='native'
      if(document.hasFocus()){
        if(target&&!native)restoreApplicationTarget(target)
        else if(snapshot.focus?.isConnected&&snapshot.focus.checkVisibility()&&!snapshot.focus.closest('[inert]'))snapshot.focus.focus({preventScroll:true})
        else document.querySelector<HTMLButtonElement>('.sidebar-settings-btn')?.focus({preventScroll:true})
      }
      if(snapshot.tabKey&&!fileTabsState.value.tabs.some(tab=>tab.key===snapshot.tabKey))showToast('原标签页已关闭，已返回当前可用内容。','info')
    }else{if(document.hasFocus()&&snapshot?.chatId&&!chats.value.some(chat=>chat.id===snapshot.chatId)){document.querySelector<HTMLButtonElement>('.sidebar-settings-btn')?.focus({preventScroll:true});showToast('原内容已关闭，已返回当前可用页面。','info')}}
    if(ticket)void window.navora?.app.returnFromSettings(ticket,true).catch(()=>{})
  }))
}
watch(settingsOpen, open => { if (open) creatorKind.value = null })
const { panels: sidebarPanels, visible: sidebarVisible, rail: sidebarRail, activate: activateSidebar, close: closeSidebar } = useSidebarDock()
const sidebarElement=ref<HTMLElement|null>(null),sidebarWidthForPresentation=computed(()=>sidebarLayout.value.width)
const browserWorkspaceActive=computed(()=>browserWorkspaceMode.value&&!settingsOpen.value&&!creatorKind.value&&!docsOpen.value)
const browserWorkspaceTabs=computed(()=>fileTabsState.value.tabs.filter(tab=>tab.kind==='browser'))
const browserWorkspaceTab=computed(()=>activeFileTab.value?.kind==='browser'?activeFileTab.value:browserWorkspaceTabs.value[0]||null)
const sidebarFloatingDisabledReason=computed(()=>browserWorkspaceActive.value&&sidebarRail.value.active==='browser'&&browserWorkspaceTab.value?'浏览器资源显示网页时使用固定侧栏':fileWorkspaceVisible.value&&browserExpanded.value?'展开工作区时仅使用固定侧栏':'')
const sidebarFloatingDisabled=computed(()=>!!sidebarFloatingDisabledReason.value)
const {mode:sidebarPresentationMode,lastPanel:sidebarLastPanel,floating:sidebarFloating,togglePin:toggleSidebarPin}=useSidebarPresentation(sidebarRail,sidebarWidthForPresentation,isMobileLayout,sidebarFloatingDisabled)
const sidebarPresentationLabel=computed(()=>sidebarFloatingDisabledReason.value||(allSidebarHidden.value?'显示侧栏':sidebarPresentationMode.value==='fixed'?'切换为悬浮侧栏':'固定侧栏'))
function toggleSidebarPresentation(){
  if(settingsOpen.value||creatorKind.value||sidebarFloatingDisabled.value)return
  if(allSidebarHidden.value){activateSidebar(sidebarPanels.value.some(panel=>panel.id===sidebarLastPanel.value)?sidebarLastPanel.value:'chats',false);return}
  toggleSidebarPin()
}
async function toggleSidebarVisibility(){if(settingsOpen.value||creatorKind.value)return;if(isMobileLayout.value){if(mobileSidebarOpen.value){closeMobileSidebar();return}if(allSidebarHidden.value)activateSidebar(sidebarPanels.value.some(panel=>panel.id===sidebarLastPanel.value)?sidebarLastPanel.value:'chats',false);mobileSidebarOpen.value=true;return}if(allSidebarHidden.value)activateSidebar(sidebarPanels.value.some(panel=>panel.id===sidebarLastPanel.value)?sidebarLastPanel.value:'chats',false);else closeSidebar()}
const railContextMenu=ref<InstanceType<typeof SidebarContextMenu>|null>(null)
function onRailContextKey(event:KeyboardEvent){if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();railContextMenu.value?.show(event)}}
function dismissFloatingSidebar(event:PointerEvent|KeyboardEvent){
  if(!sidebarFloating.value||allSidebarHidden.value||settingsOpen.value||creatorKind.value)return
  if(event instanceof KeyboardEvent){if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||event.keyCode===229)return;if(hasVisibleUi('.v-overlay--active,.sidebar-ctx-panel:not([data-browser-tab-preview])'))return;closeSidebar();event.preventDefault();document.querySelector<HTMLElement>('.window-sidebar-toggle')?.focus({preventScroll:true});return}
  const target=event.target instanceof Element?event.target:null
  if(!target||sidebarElement.value?.contains(target)||target.closest('.activity-rail,.window-sidebar-toggle,.sidebar-ctx-panel,.v-overlay--active')||sidebarResizing.value)return
  closeSidebar()
}
onMounted(()=>{document.addEventListener('pointerdown',dismissFloatingSidebar,true);window.addEventListener('keydown',dismissFloatingSidebar)})
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',dismissFloatingSidebar,true);window.removeEventListener('keydown',dismissFloatingSidebar)})
const fileManagerMounted=ref(false),fileManagerMode=ref(sidebarRail.value.active==='workspace')
watch(()=>sidebarRail.value.active,id=>{if(id){fileManagerMode.value=id==='workspace';pluginWorkspaceMode.value=id==='plugins';browserWorkspaceMode.value=id==='browser'}},{immediate:true})
const fileManagerOwnerId=ref(''),fileManagerDirectory=ref('.')
const fileManagerOwner=computed(()=>chats.value.find(chat=>chat.id===fileManagerOwnerId.value))
const fileManagerActive=computed(()=>fileManagerMode.value&&!settingsOpen.value&&!creatorKind.value&&!docsOpen.value)
watch(browserWorkspaceActive,visible=>{if(visible)hideResources()})
const pluginWorkspaceActive=computed(()=>pluginWorkspaceMode.value&&!settingsOpen.value&&!creatorKind.value&&!docsOpen.value)
watch(pluginWorkspaceActive,visible=>{if(visible){pluginWorkspaceMounted.value=true;hideResources()}},{immediate:true})
function browseFiles(selection:{chatId:string;path:string}){fileManagerOwnerId.value=selection.chatId;fileManagerDirectory.value=selection.path}
async function openResourceChat(id:string){await selectChat(id);activateSidebar('chats',false)}
watch(fileManagerActive,visible=>{if(visible){fileManagerMounted.value=true;hideResources();if(activeFileTab.value?.kind==='browser')hideFileWorkspace()}},{immediate:true})
const loadedResourcePanels=ref(new Set<string>())
watch(()=>sidebarRail.value.active,id=>{if(id)loadedResourcePanels.value=new Set([...loadedResourcePanels.value,id])},{immediate:true})
const conversationIsVisible=computed(()=>!docsOpen.value&&!settingsOpen.value&&!creatorKind.value&&!fileManagerActive.value&&!pluginWorkspaceActive.value&&!browserWorkspaceActive.value&&!(fileWorkspaceVisible.value&&(browserExpanded.value||fileWorkspaceOverlay.value)&&!workspaceConversationActive.value))
watch([resourceOpen,conversationIsVisible],([open,visible])=>{resourceReading.value=open&&visible},{immediate:true,flush:'sync'})
let parkedConversation:{chatId:string;top:number;follow:boolean}|undefined
let conversationReading:{chatId:string;top:number;follow:boolean}|undefined
let conversationScrollVersion=0,restoringConversation=false,messageJumpInProgress=false
let messageReadingIntent=false,userMessageScroll=false,userMessageScrollPending=false
watch(conversationIsVisible,(visible,wasVisible,onCleanup)=>{
  if(!visible){cancelMessageJump();userMessageScroll=false;userMessageScrollPending=false}
  const version=++conversationScrollVersion
  if(!visible&&wasVisible&&msgBox.value&&activeId.value){
    // A display:none layout may already report zero before an observer runs.
    // Keep the last real reading position rather than saving that hidden zero.
    parkedConversation=msgBox.value.checkVisibility()
      ?{chatId:activeId.value,top:msgBox.value.scrollTop,follow:stickToBottom.value}
      :conversationReading?.chatId===activeId.value?{...conversationReading}:undefined
  }
  if(!visible){restoringConversation=false;return}
  const parked=parkedConversation
  if(!parked||parked.chatId!==activeId.value)return
  restoringConversation=true
  let stale=false;onCleanup(()=>{stale=true;if(version===conversationScrollVersion)restoringConversation=false})
  const restore=()=>{
    if(stale||version!==conversationScrollVersion||!conversationIsVisible.value||!msgBox.value?.checkVisibility()||parked.chatId!==activeId.value)return
    msgBox.value.scrollTop=parked.follow?msgBox.value.scrollHeight:parked.top
    stickToBottom.value=parked.follow
    messageReadingIntent=!parked.follow
    showJumpBottom.value=!parked.follow&&msgBox.value.scrollHeight>msgBox.value.clientHeight+40
    conversationReading={...parked,top:msgBox.value.scrollTop}
    return true
  }
  void nextTick(()=>requestAnimationFrame(()=>{
    if(!restore())return
    requestAnimationFrame(()=>{if(!restore())return;parkedConversation=undefined;restoringConversation=false})
  }))
},{flush:'sync'})
const allSidebarHidden = computed(() => sidebarPanels.value.every(panel => !sidebarVisible.value[panel.id]))
watch(()=>sidebarVisible.value.chats,visible=>{if(!visible)exitChatBatchMode()})
async function toggleSidebarGroup(id:string){const leavingDocs=docsOpen.value;if(leavingDocs)await closeDocsPage();else ++docsNavigation;if(!await canLeaveSettings())return;const force=leavingDocs||settingsOpen.value||!!creatorKind.value||(id==='plugins'&&!pluginWorkspaceMode.value)||(id==='workspace'&&!fileManagerMode.value)||(id==='browser'&&!browserWorkspaceMode.value);settingsOpen.value=false;creatorKind.value=null;exitChatBatchMode();if(force){fileManagerMode.value=id==='workspace';pluginWorkspaceMode.value=id==='plugins';browserWorkspaceMode.value=id==='browser'}activateSidebar(id,!force)}
const docsChapter=ref(''),docsSection=ref(''),docsWorkspace=ref<{runAction:(action:string)=>unknown}>()
const mobileSidebarOpen = ref(false)
const chatSearchOpen = ref(false)
const chatSearchFocusRequest=ref(0)
watch(windowFind.opened,opened=>{if(opened)chatSearchOpen.value=false})
const chatSearchQuery = ref('')
const chatSearchInput = ref<HTMLInputElement | null>(null)
const toast = ref({ show: false, text: '', color: 'error' as string })
const askReq = ref<AgentAskRequest | null>(null)
/** Pending asks keyed by chatId — kept when shelved or when ask arrives for a background chat. */
const pendingAsks = ref<Record<string, AgentAskRequest>>({})
/** Absolute expiry time (ms) for each pending ask id */
const askExpiresAtById = ref<Record<string, number>>({})
/** Ask ids the user explicitly shelved — don't auto-reopen on selectChat */
const userShelvedAskIds = ref<Set<string>>(new Set())
const phaseByChat = ref<Record<string, { phase: AgentPhase; detail: string }>>({})

function formatAskRemaining(expiresAt: number | undefined): string {
  if (!expiresAt) return ''
  void nowTick.value
  const left = Math.max(0, expiresAt - Date.now())
  if (left <= 0) return '即将超时'
  const sec = Math.ceil(left / 1000)
  if (sec >= 60) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `剩余 ${m}:${String(s).padStart(2, '0')}`
  }
  return `剩余 ${sec} 秒`
}

/** Remaining timeout as 0–100 for countdown progress bars. */
function askRemainingPctOf(id: string | undefined, timeoutMs: number | undefined): number {
  if (!id) return 0
  const expires = askExpiresAtById.value[id]
  const total = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 0
  if (!expires || !(total > 0)) return 0
  void nowTick.value
  return Math.round(Math.min(1, Math.max(0, (expires - Date.now()) / total)) * 1000) / 10
}


const inlineAskRemainingLabel = computed(() => {
  const req = activePendingAsk.value
  if (!req) return ''
  return formatAskRemaining(askExpiresAtById.value[req.id])
})

const inlineAskRemainingUrgent = computed(() => {
  const req = activePendingAsk.value
  if (!req) return false
  const expires = askExpiresAtById.value[req.id]
  if (!expires) return false
  void nowTick.value
  return expires - Date.now() <= 15000
})

const inlineAskRemainingPct = computed(() => {
  const req = activePendingAsk.value
  if (!req) return 0
  return askRemainingPctOf(req.id, req.timeoutMs)
})

function trackAskExpiry(req: AgentAskRequest) {
  const ms = typeof req.timeoutMs === 'number' ? req.timeoutMs : FORK_ASK_TIMEOUT_DEFAULT_MS
  if (!(ms > 0)) {
    clearAskExpiry(req.id)
    return
  }
  if (!askExpiresAtById.value[req.id]) {
    askExpiresAtById.value = {
      ...askExpiresAtById.value,
      [req.id]: Date.now() + ms,
    }
  }
}

function clearAskExpiry(id: string) {
  if (!askExpiresAtById.value[id]) return
  const next = { ...askExpiresAtById.value }
  delete next[id]
  askExpiresAtById.value = next
  const shelved = new Set(userShelvedAskIds.value)
  shelved.delete(id)
  userShelvedAskIds.value = shelved
}

function pendingAskBadge(chatId: string): string {
  const req = pendingAsks.value[chatId]
  if (!req) return '询问/决策'
  const step = req.meta?.step
  const total = req.meta?.totalSteps
  if (typeof step === 'number' && step >= 1 && typeof total === 'number' && total >= 1) {
    return `询问/决策 ${Math.floor(step)}/${Math.floor(total)}`
  }
  if (req.kind === 'continue_rounds') return '待决策 · 轮数'
  if (req.kind === 'download_confirm') return '待决策 · 被动下载'
  return '询问/决策'
}

const activePendingAsk = computed(() => {
  const id = activeId.value
  if (!id) return null
  return pendingAsks.value[id] || pendingAskForSidebar(id)
})

const showInlinePendingAsk = computed(() => Boolean(activePendingAsk.value))

const showInlinePerm = computed(() => {
  const req = permReq.value
  const id = activeId.value
  if (!req || !id) return false
  if (req.chatId === id) return true
  const chat = chats.value.find((c) => c.id === req.chatId)
  return chat?.kind === 'sub' && chat.parentChatId === id
})

/** Compact progress for inline card / dock — step only; title lives in the question line. */
const inlineAskProgress = computed(() => {
  const req = activePendingAsk.value
  if (!req) return ''
  const step = req.meta?.step
  const total = req.meta?.totalSteps
  if (typeof step === 'number' && step >= 1 && typeof total === 'number' && total >= 1) {
    return `${Math.floor(step)}/${Math.floor(total)}`
  }
  if (typeof step === 'number' && step >= 1) return `第 ${Math.floor(step)} 步`
  if (req.kind === 'continue_rounds') return '推理轮数'
  if (req.kind === 'download_confirm') return '被动文件下载'
  return ''
})

const inlineDecisionEl = ref<HTMLElement | null>(null)
const inlineDecisionVisible=ref(false)
watch(inlineDecisionEl,(element,_previous,onCleanup)=>{
  inlineDecisionVisible.value=false
  if(!element)return
  const observer=new IntersectionObserver(entries=>{inlineDecisionVisible.value=entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>=0.3)},{threshold:[0,0.3]})
  observer.observe(element)
  onCleanup(()=>observer.disconnect())
})

const permChatTitle = computed(() => {
  if (!permReq.value) return ''
  const c = chats.value.find((x) => x.id === permReq.value!.chatId)
  return c?.title || permReq.value.chatId
})

const permExpiryById = ref<Record<string,{expiresAt:number;totalMs:number}>>({})
const permExpiresAt = computed(() => permReq.value ? permExpiryById.value[permReq.value.id]?.expiresAt || 0 : 0)
const permTimeoutTotalMs = computed(() => permReq.value ? permExpiryById.value[permReq.value.id]?.totalMs || 0 : 0)

function trackPermExpiry(req: PermissionRequest) {
  const ms = typeof req.timeoutMs === 'number' ? req.timeoutMs : 120000
  if (!(ms > 0)) {
    clearPermExpiry(req.id)
    return
  }
  permExpiryById.value = {...permExpiryById.value,[req.id]:{totalMs:ms,expiresAt:Date.now()+ms}}
}

function clearPermExpiry(id:string) {
  if(!(id in permExpiryById.value))return
  const next={...permExpiryById.value};delete next[id];permExpiryById.value=next
}

function removePermRequest(id:string) {
  pendingPermRequests.value=pendingPermRequests.value.filter(request=>request.id!==id)
  clearPermExpiry(id)
  delete decisionSubmissions[id]
}

const permRemainingLabel = computed(() => {
  if (!permReq.value || !(permExpiresAt.value > 0)) return ''
  return formatAskRemaining(permExpiresAt.value)
})

const permRemainingUrgent = computed(() => {
  if (!(permExpiresAt.value > 0)) return false
  void nowTick.value
  return permExpiresAt.value - Date.now() <= 15000
})

const permRemainingPct = computed(() => {
  const total = permTimeoutTotalMs.value
  const expires = permExpiresAt.value
  if (!(total > 0) || !(expires > 0)) return 0
  void nowTick.value
  return Math.round(Math.min(1, Math.max(0, (expires - Date.now()) / total)) * 1000) / 10
})

function showToast(text: string, color = 'error') {
  if(browserViewports.value.length){window.dispatchEvent(new CustomEvent('navora:ui-notice',{detail:{message:text}}));return}
  toast.value = { show: true, text, color }
}
const appLinks=useAppLinks(text=>showToast(text,'warning'))
let unsubFileTransfer:(()=>void)|undefined
let unsubBrowserPresent:(()=>void)|undefined
let browserPresentRequest=0
let unsubTree: (() => void) | undefined
let unsubAgent: (() => void) | undefined
let unsubChats: (() => void) | undefined
let unsubConfig: (() => void) | undefined
let unsubPerm: (() => void) | undefined
let unsubPermCancel: (() => void) | undefined
let unsubAsk: (() => void) | undefined
let unsubAskCancel: (() => void) | undefined
let unsubQuitRequested:(()=>void)|undefined
let dragDepth = 0
let tickTimer: ReturnType<typeof setInterval> | undefined
let resizeObserver: ResizeObserver | undefined
let stopMessageResizeWatch: (() => void) | undefined
let onWinResize: (() => void) | undefined

const showFollowupSuggestions = ref(true)
const showReadPages = ref(true)
const showRunLogs = ref(true)
const collapseToolRuns = ref(true)
const collapseRunLogs = ref(true)
const readPagesPanelOpen = ref(false)
const readPagesPanelList = ref<AnswerSource[]>([])
const readPagesPanelFromId = ref<string | null>(null)
const readSourcesPage=ref(0)
const readSourcesNative=computed(()=>readSourcesPanel(readPagesPanelList.value,`${activeId.value}:${readPagesPanelFromId.value}`,readSourcesPage.value))
function readSourcesAction(action:NativePanelAction){
  if(!readPagesPanelOpen.value||!activeId.value||!readPagesPanelFromId.value)return
  if(action.type!=='click')return
  if(action.id==='read-sources-close')closeReadPagesPanel()
  else if(action.id==='read-sources-previous')readSourcesPage.value=Math.max(0,readSourcesNative.value.page-1)
  else if(action.id==='read-sources-next')readSourcesPage.value=Math.min(Math.max(0,Math.ceil(readPagesPanelList.value.length/30)-1),readSourcesNative.value.page+1)
  else{const url=readSourcesNative.value.actions.get(action.id);if(url&&readPagesPanelList.value.some(source=>source.url===url))openSourceUrl(url)}
}
const followupSuggestions = ref<FollowupSuggestion[]>([])
const followupsByChat = ref<Record<string, FollowupSuggestion[]>>({})
const { openInstallerById } = useStoreUi()
const storeFollowups = computed(() =>
  followupSuggestions.value.filter((s) => s.action.type === 'store_install'),
)
const textFollowups = computed(() =>
  followupSuggestions.value.filter((s) => s.action.type !== 'store_install'),
)
const expandedTools = ref<Record<string, boolean>>({})
const expandedLogs = ref<Record<string, boolean>>({})
const expandedProcesses=ref<Record<string,boolean>>({})
const liveReasoningByChat = ref<
  Record<string, { content: string; status: 'live' | 'done'; round?: number }>
>({})
const liveReasoningForced = ref<Record<string, boolean | undefined>>({})
const liveAnswerByChat = ref<Record<string, string>>({})
const liveAnswerText = computed(() => activeId.value ? liveAnswerByChat.value[activeId.value] || '' : '')
const liveReasoningBodyEl = ref<HTMLElement | null>(null)
const logOverflowById = ref<Record<string, boolean>>({})
const logMeasureEls = new Map<string, HTMLElement>()
const logResizeObservers = new Map<string, ResizeObserver>()

const annotationOwner=computed(()=>activeId.value||'')
const {entries:chatAnnotationEntries,recovery:chatAnnotationRecovery,error:chatAnnotationError,refresh:refreshChatAnnotations}=useChatAnnotations(annotationOwner)
const annotationCardBusy=ref('')
watch(activeId,cancelAnnotationEdit,{flush:'sync'})
onBeforeUnmount(cancelAnnotationEdit)
const messageBlocks = computed(() => conversationOutputBlocks(active.value?.messages || [],showRunLogs.value))
async function annotationCardAction(entry:AnnotationChatEntry,action:AnnotationChatAction,copyId?:string){
  if(annotationCardBusy.value||!activeId.value||!window.navora)return
  const chatId=activeId.value,api=window.navora.browser.workspace,note=entry.note,target=entry.target
  annotationCardBusy.value=entry.key
  try{
    if(action==='edit'||action==='copy'||action==='latest'){
      const pageId=note?.pageId||target?.pageId
      if(!pageId)return
      const state=await api.tabState(chatId),page=state.pages.find(page=>page.windowId===pageId)
      if(activeId.value!==chatId)return
      if(!page)throw Error('原页面已关闭，批注内容和证据仍保留。')
      if(page.presentation==='detached')await api.tabAction({chatId,pageId,action:'attach'})
      if(activeId.value!==chatId)return
      await api.tabAction({chatId,pageId,action:'activate'})
      if(activeId.value!==chatId)return
      if(!await presentBrowserResource(pageId,chatId))throw Error('无法打开批注所属页面，请重试。')
      await nextTick();if(activeId.value!==chatId)return
      const detail:AnnotationChatEdit={chatId,pageId,noteId:note?.id,targetId:target?.id,copyId,latest:action==='latest'}
      requestAnnotationEdit(detail)
    }else if(action==='send'&&note){const reference=await api.presentAnnotation(chatId,note.id,{revealPage:false});if(activeId.value===chatId)addRef(reference)}
    else if(action==='evidence')await openFilePreview(note?.screenshotPath||target!.screenshotPath,chatId)
    else if(action==='locate'&&note){if(!await api.locateAnnotation(chatId,note.id))throw Error('原位置已变化或页面不可用，请查看创建时证据。')}
    else if(action==='resolve'&&note)await api.updateAnnotation(chatId,note.id,note.revision,{taskState:note.taskState==='resolved'?'pending':'resolved'})
    else if(action==='delete'&&note)await api.removeAnnotation(chatId,note.id)
    else if(action==='discard'&&target)await api.discardAnnotationTarget(chatId,target.pageId,target.id,target.version)
    await refreshChatAnnotations()
  }catch(cause){showToast(cause instanceof Error?cause.message:String(cause),'warning')}
  finally{annotationCardBusy.value=''}
}
const processGroups=computed(()=>conversationProcessGroups(active.value?.messages||[],agentRunning.value,showRunLogs.value))
const processHeaders=computed(()=>new Map(processGroups.value.map(group=>[group.firstId,group])))
const processByMessage=computed(()=>new Map(processGroups.value.flatMap(group=>group.messageIds.map(id=>[id,group] as const))))
function processMessageHidden(id:string){const group=processByMessage.value.get(id);return !!group&&group.processIds.has(id)&&!expandedProcesses.value[group.key]}
function processDetailsVisible(id:string){const group=processByMessage.value.get(id);return !group||!!expandedProcesses.value[group.key]}
function toggleProcess(key:string){expandedProcesses.value={...expandedProcesses.value,[key]:!expandedProcesses.value[key]}}
async function revealMessageProcess(id:string){const group=processByMessage.value.get(id);if(group&&!expandedProcesses.value[group.key]){expandedProcesses.value={...expandedProcesses.value,[group.key]:true};await nextTick()}}
const artifactChatId = computed(() => activeId.value || '')
const {entries: artifactEntries} = useWorkspaceResources(artifactChatId)
const replyFinalIds=computed(()=>new Set(finalOutputs(active.value?.messages||[]).map(message=>message.id)))
const replyFilesById = computed(() => replyArtifactGroups(artifactEntries.value, active.value?.messages || []))

const activeChatError = computed(() => {
  const id = activeId.value
  if (!id) return null
  const remembered = chatErrors.value[id]
  if (remembered) return remembered
  const fromMsgs = lastUserTurnFailed(active.value?.messages)
  if (!fromMsgs.failed) return null
  return { message: fromMsgs.summary || '上次执行出错中断' }
})

/** Interrupt (error or user stop): show retry until the user sends a new question. */
const showRetryBar = computed(() => {
  if (!activeId.value || agentRunning.value || sending.value) return false
  if (retrying.value) return true
  return Boolean(activeChatError.value)
})

const showFollowupBlock = computed(() => {
  if (agentRunning.value || showRetryBar.value) return false
  if (storeFollowups.value.length) return true
  if (!showFollowupSuggestions.value) return false
  return textFollowups.value.length > 0
})

function setFollowups(chatId: string, list: Array<string | FollowupSuggestion>) {
  const cleaned = normalizeFollowupList(list)
  followupsByChat.value = { ...followupsByChat.value, [chatId]: cleaned }
  if (chatId === activeId.value) followupSuggestions.value = cleaned
}

function clearFollowups(chatId?: string) {
  if (!chatId) {
    followupSuggestions.value = []
    return
  }
  const next = { ...followupsByChat.value }
  delete next[chatId]
  followupsByChat.value = next
  if (chatId === activeId.value) followupSuggestions.value = []
}

let modelLoadSequence=0
async function refreshAiProviders(cfg?: AppConfig | null) {
  const sequence=++modelLoadSequence
  modelLoading.value=true;modelLoadError.value=''
  try {
    const c = cfg ?? (await window.navora?.config.get())
    if (!c?.ai)throw Error('无法读取模型配置')
    if(sequence!==modelLoadSequence)return
    aiProviders.value = (c.ai.providers || []).map((p) =>
      normalizeProvider({ ...p, models: [...(p.models || [])] }),
    )
    aiDefaultProviderId.value = c.ai.default_provider || c.ai.providers?.[0]?.id || ''
    await refreshProviderKeyFlags()
  } catch {
    if(sequence===modelLoadSequence)modelLoadError.value='无法读取模型配置，请重试。'
  } finally {if(sequence===modelLoadSequence)modelLoading.value=false}
}

async function loadUiPrefs() {
  try {
    const cfg = await window.navora?.config.get()
    applyUiPrefs(cfg)
    await refreshAiProviders(cfg)
  } catch {
    showFollowupSuggestions.value = false
    showReadPages.value = true
    showRunLogs.value = true
    collapseToolRuns.value = true
    collapseRunLogs.value = true
    maxComposerChars.value = 16000
  }
}

function applyUiPrefs(cfg: AppConfig | null | undefined) {
  if (!cfg) return
  showFollowupSuggestions.value = cfg.app?.show_followup_suggestions === true
  showReadPages.value = cfg.app?.show_read_pages !== false
  showRunLogs.value = cfg.app?.show_run_logs !== false
  collapseToolRuns.value = cfg.app?.collapse_tool_runs !== false
  collapseRunLogs.value = cfg.app?.collapse_run_logs !== false
  const max = Number(cfg.app?.max_composer_chars)
  maxComposerChars.value =
    Number.isFinite(max) && max >= 1000 ? Math.min(200000, Math.floor(max)) : 16000
}

async function refreshProviderKeyFlags() {
  if (!window.navora) return
  const next: Record<string, boolean> = {}
  await Promise.all(
    aiProviders.value.map(async (p) => {
      if (!p.api_key_ref) {
        next[p.id] = false
        return
      }
      try {
        const st = await window.navora!.secrets.getApiKey(p.api_key_ref)
        next[p.id] = st.configured
      } catch {
        next[p.id] = false
      }
    }),
  )
  providerKeyOk.value = next
}

const composerComposing=ref(false)
let composerCompositionTimer:ReturnType<typeof setTimeout>|undefined
function onComposerCompositionStart(){clearTimeout(composerCompositionTimer);composerComposing.value=true}
function onComposerCompositionEnd(){clearTimeout(composerCompositionTimer);composerCompositionTimer=setTimeout(()=>{composerComposing.value=false},0)}
onBeforeUnmount(()=>clearTimeout(composerCompositionTimer))
watch(activeId,()=>{clearTimeout(composerCompositionTimer);composerComposing.value=false})
const queueBusy=ref(false)
async function changeQueue(action:'edit'|'remove'|'insert'|'resume',id='',content='',document?:ComposerDocument,baseRevision?:number) {
  const chatId=activeId.value,api=window.navora?.agent
  if(!chatId||!api||queueBusy.value)return
  queueBusy.value=true
  try{
    const result=await (action==='edit'?api.queueEdit(chatId,id,content,{document,baseRevision}):action==='remove'?api.queueRemove(chatId,id):action==='insert'?api.queueInsert(chatId,id):api.queueResume(chatId))
    if(result&&active.value?.id===chatId)active.value={...active.value,queuedMessages:result.queuedMessages,queuePaused:result.queuePaused}
  }catch{showToast('队列操作失败，请重试','error')}finally{queueBusy.value=false}
}
const composerProblem=computed(()=>{if(!taskDeclarationsSupported(composerDocument.value.declarations))return '此任务声明暂不支持，内容已保留，请使用兼容版本处理后发送。';const blocks=previewComposerDocument(composerDocument.value).contexts;const pending=blocks.find(item=>item.block.status==='loading');if(pending)return `正在准备“${pending.block.label}”，请稍候。`;const missing=blocks.find(item=>item.block.mode==='reference'&&(item.block.status==='missing'||item.block.status==='error'));return missing?`“${missing.block.label}”的来源不可用，请更换来源、移除引用或改用已有摘录。`:''})
const canSend = computed(() => !modelSelectionBusy.value && !executionModeBusy.value && !modelLoading.value && !modelLoadError.value && !!chatModelKey.value && !modelSelectionInvalid.value && !draftUnsupported.value && !draftConflict.value && !composerProblem.value && Boolean(draft.value.trim() || contextRefs.value.length) && draft.value.length <= maxComposerChars.value)
const composerHasReadyPayload=computed(()=>!composerProblem.value&&Boolean(draft.value.trim()||contextRefs.value.length))
const composerMainMode=computed<'send'|'queue'|'stop'>(()=>agentRunning.value?composerHasReadyPayload.value?activeOwnQuestionnaire.value?'send':'queue':'stop':'send')
function onComposerMainAction(){if(composerComposing.value||sending.value)return;if(composerMainMode.value==='stop'){void stopAgent();return}void send()}
const draftLen = computed(() => draft.value.length)
const draftNearLimit = computed(() => draftLen.value >= maxComposerChars.value * 0.9)
const draftAtLimit = computed(() => draftLen.value >= maxComposerChars.value)

const permPresetOptions: {
  title: string
  value: PermissionPreset
  desc: string
  icon: string
}[] = [
  { title: '保守', value: 'conservative', desc: '敏感操作多询问', icon: 'shield-halved' },
  { title: '均衡', value: 'balanced', desc: '常用能力较顺畅', icon: 'scale-balanced' },
  { title: '放手', value: 'open', desc: '除技能外全部自动执行', icon: 'unlock' },
  { title: '自定义', value: 'custom', desc: '已单独调整过档位', icon: 'sliders' },
]

const chatPermissions = computed((): ChatPermissions => {
  const stored = active.value?.permissions
  if (stored) {
    const preset = stored.preset || detectPermissionPreset(stored.modes)
    if (preset === 'conservative' || preset === 'balanced' || preset === 'open') {
      return { preset, modes: modesForPreset(preset) }
    }
    return {
      preset: 'custom',
      modes: stored.modes || modesForPreset('balanced'),
    }
  }
  if (settingsPermissions.value) {
    const preset = settingsPermissions.value.preset
    if (preset === 'conservative' || preset === 'balanced' || preset === 'open') {
      return { preset, modes: modesForPreset(preset) }
    }
    return settingsPermissions.value
  }
  return { preset: 'balanced', modes: modesForPreset('balanced') }
})

const permPresetLabel = computed(() => {
  const map: Record<PermissionPreset, string> = {
    conservative: '保守',
    balanced: '均衡',
    open: '放手',
    custom: '自定义',
  }
  return map[chatPermissions.value.preset] || '权限'
})

const permPresetIcon = computed(
  () =>
    permPresetOptions.find((o) => o.value === chatPermissions.value.preset)?.icon || 'shield-halved',
)

const chatProviderId = computed(() => {
  const resolved = resolveProvider(
    aiProviders.value,
    aiDefaultProviderId.value,
    active.value?.providerId,
  )
  return resolved?.id || ''
})

const chatModelName = computed(() => {
  const resolved = resolveProvider(
    aiProviders.value,
    aiDefaultProviderId.value,
    active.value?.providerId,
  )
  return resolveModelName(resolved, active.value?.model)
})

const chatModelSettings = computed(() => modelCapabilities(aiProviders.value.find(p => p.id === chatProviderId.value), chatModelName.value))
const modelSelectionInvalid=computed(()=>!!active.value?.providerId&&!aiProviders.value.some(provider=>provider.id===active.value?.providerId))
const chatModelLabel = computed(() => modelSelectionInvalid.value?'模型不可用':chatModelSettings.value.label || chatModelName.value || '选择模型')
const reasoningLevels = computed(() => chatModelSettings.value.reasoning.enabled ? chatModelSettings.value.reasoning.levels : [])
const selectedReasoningLevel = computed(() => {
  const selected = active.value?.reasoningLevel
  return reasoningLevels.value.some(l => l.id === selected) ? selected! : chatModelSettings.value.reasoning.default
})
async function applyReasoningLevel(level: string) {
  if (!window.navora || !activeId.value || agentRunning.value || sending.value || modelSelectionBusy.value || executionModeBusy.value) return
  modelSelectionBusy.value=true
  const chatId=activeId.value
  try{
    const updated=await window.navora.chats.setProvider(chatId,chatProviderId.value,chatModelName.value,level)
    if(updated&&activeId.value===chatId)active.value=updated
    await refreshList()
  }catch(error){showToast(error instanceof Error?error.message:'切换思考等级失败')}
  finally{modelSelectionBusy.value=false}
}

const chatModelKey = computed(() =>
  chatProviderId.value && chatModelName.value
    ? `${chatProviderId.value}::${chatModelName.value}`
    : '',
)

const modelMenuOptions = computed(() => {
  const out: {
    key: string
    providerId: string
    model: string
    label: string
    providerLabel: string
    hasKey: boolean
    capabilities:string
  }[] = []
  for (const raw of aiProviders.value) {
    const p = normalizeProvider({ ...raw, models: [...(raw.models || [])] })
    const models = p.models.length ? p.models : [p.model]
    for (const m of models) {
      out.push({
        key: `${p.id}::${m}`,
        providerId: p.id,
        model: m,
        label: modelCapabilities(p,m).label,
        providerLabel: p.label || p.id,
        hasKey: providerKeyOk.value[p.id] === true,
        capabilities:`${formatUsageCount(modelCapabilities(p,m).context_window)} 上下文${modelCapabilities(p,m).input_types.includes('image')?' · 图片':''}${modelCapabilities(p,m).reasoning.enabled?' · 思考':''}`,
      })
    }
  }
  return out
})

const filteredModelOptions = computed(()=>modelMenuOptions.value.filter(option=>!modelQuery.value.trim()||(option.label+' '+option.model+' '+option.providerLabel).toLocaleLowerCase().includes(modelQuery.value.trim().toLocaleLowerCase())))

const modelOptionGroups=computed(()=>aiProviders.value.map(provider=>({id:provider.id,label:provider.label||provider.id,options:filteredModelOptions.value.filter(option=>option.providerId===provider.id)})).filter(group=>group.options.length))
function modelPanelKey(event:KeyboardEvent){if(event.isComposing||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const panel=event.currentTarget as HTMLElement,items=[...panel.querySelectorAll<HTMLButtonElement>('.model-panel-options button[role=radio]:not(:disabled)')];if(!items.length)return;event.preventDefault();const at=items.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus({preventScroll:true});items[next]?.scrollIntoView({block:'nearest'})}
const usageHistoryEst=computed(()=>estimateContextText((active.value?.messages||[]).filter(message=>message.role!=='log').map(message=>message.content||'').join('\n')))
const usageDraftEst=computed(()=>estimateContextText(draft.value))
const usageTokensEst=computed(()=>usageHistoryEst.value+usageDraftEst.value)
const actualUsageMessage=computed(()=>[...(active.value?.messages||[])].reverse().find(message=>message.role==='assistant'&&!message.meta?.partial&&message.meta?.phase!=='progress'))
const actualUsage=computed(()=>normalizeModelUsage(actualUsageMessage.value?.meta?.usage))
const actualUsageModel=computed(()=>String((actualUsageMessage.value?.meta?.usageModel as {model?:string}|undefined)?.model||''))
const usageRatio = computed(() => usageTokensEst.value / Math.max(1, chatModelSettings.value.context_window))
const usagePctLabel = computed(() => `${Math.round(usageRatio.value * 100)}%`)
function formatUsageCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (value >= 100_000) return `${Math.round(value / 1_000)}K`
  return value.toLocaleString()
}
const USAGE_RING_LEN = 2 * Math.PI * 14
const usageDash = computed(
  () => `${(Math.min(1, usageRatio.value) * USAGE_RING_LEN).toFixed(2)} ${USAGE_RING_LEN.toFixed(2)}`,
)
const usageTone = computed(() => {
  if (usageRatio.value >= 0.85) return 'hot'
  if (usageRatio.value >= 0.6) return 'warm'
  return 'cool'
})

async function refreshSettingsPermissions() {
  if (!window.navora) return
  try {
    const cfg = await window.navora.config.get()
    settingsPermissions.value = {
      preset: cfg.permissions.preset,
      modes: { ...cfg.permissions.modes },
    }
  } catch {
    /* ignore */
  }
}

async function applyChatPreset(preset: PermissionPreset) {
  if (!window.navora || !activeId.value) return
  const chatId=activeId.value
  const modes =
    preset === 'custom'
      ? { ...chatPermissions.value.modes }
      : modesForPreset(preset)
  try {
    const chat = await window.navora.chats.setPermissions(chatId, { preset, modes })
    if (chat) {
      if(activeId.value===chatId)active.value = chat
      const idx = chats.value.findIndex((c) => c.id === chat.id)
      if (idx >= 0) {
        const next = chats.value.slice()
        next[idx] = chat
        chats.value = next
      }
    }
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : '更新权限失败')
  } finally {
    permMenuOpen.value = false
  }
}

async function applyChatModel(providerId: string, model: string) {
  if (!window.navora || !activeId.value || agentRunning.value || sending.value || modelSelectionBusy.value || executionModeBusy.value) return
  modelSelectionBusy.value=true
  const chatId=activeId.value
  try {
    const chat = await window.navora.chats.setProvider(chatId, providerId, model, null)
    if (chat) {
      if(activeId.value===chatId)active.value = chat
      const idx = chats.value.findIndex((c) => c.id === chat.id)
      if (idx >= 0) {
        const next = chats.value.slice()
        next[idx] = chat
        chats.value = next
      }
    }
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : '切换模型失败')
  } finally {
    modelSelectionBusy.value=false
  }
}

const workspaceConversationStatus=computed(()=>visiblePermRequests.value.length||activePendingAsk.value?`待处理 ${visiblePermRequests.value.length+(activePendingAsk.value?1:0)}`:agentRunning.value?phaseLabel.value:'')
const phaseLabel = computed(() => {
  if (!agentRunning.value) return ''
  switch (phase.value) {
    case 'thinking':
      return phaseDetail.value || '正在思考…'
    case 'calling_tool':
      return phaseDetail.value || '正在调用工具…'
    case 'awaiting_permission':
      return phaseDetail.value || '等待权限确认…'
    case 'awaiting_user':
      return phaseDetail.value || '等待你的选择…'
    case 'awaiting_skill_review':
      return phaseDetail.value || '等待确认技能…'
    case 'observing':
      return '已记录你的操作，继续执行…'
    default:
      return 'Agent 运行中…'
  }
})

const liveReasoningEntry = computed(() => {
  const id = activeId.value
  if (!id) return null
  return liveReasoningByChat.value[id] || null
})

const liveReasoningText = computed(() => String(liveReasoningEntry.value?.content || '').trim())

const liveReasoningRoundLabel = computed(() => {
  const r = liveReasoningEntry.value?.round
  return typeof r === 'number' && r > 0 ? `第 ${r} 轮` : ''
})

/** Reasoning stays secondary; opening it is an explicit reading action. */
const liveReasoningOpen = computed(() => {
  const id = activeId.value
  if (!id || !liveReasoningText.value) return false
  const forced = liveReasoningForced.value[id]
  if (forced !== undefined) return forced
  return false
})

function toggleLiveReasoning() {
  const id = activeId.value
  if (!id || !liveReasoningText.value) return
  liveReasoningForced.value = {
    ...liveReasoningForced.value,
    [id]: !liveReasoningOpen.value,
  }
}

type ToolDownloadProgressMeta = {
  dest?: string
  bytesTotal?: number
  bytesPart?: number
  contentLength?: number
  partIndex?: number
  partsTotal?: number
  percent?: number
  indeterminate?: boolean
}

function formatDlBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.floor(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function toolDownloadProgress(m: ChatMessage): ToolDownloadProgressMeta | null {
  if (m.role !== 'tool') return null
  // Prefer raw running status so the bar stays visible during download even if
  // local phase bookkeeping briefly disagrees with agentRunning.
  if (String(m.meta?.status || '') !== 'running') return null
  const raw = m.meta?.downloadProgress
  if (!raw || typeof raw !== 'object') return null
  const p = raw as ToolDownloadProgressMeta
  const bytes = typeof p.bytesPart === 'number' ? p.bytesPart : 0
  const pct = typeof p.percent === 'number' ? Math.max(0, Math.min(100, p.percent)) : undefined
  // 0% with no bytes looks like an empty bar — use indeterminate pulse instead.
  const indeterminate =
    p.indeterminate === true || pct == null || (pct === 0 && bytes <= 0)
  return {
    ...p,
    indeterminate,
    percent: indeterminate ? undefined : pct,
  }
}

function toolDownloadProgressLabel(m: ChatMessage): string {
  const p = toolDownloadProgress(m)
  if (!p) return ''
  const part =
    typeof p.partsTotal === 'number' && p.partsTotal > 1
      ? ` · 分片 ${(p.partIndex ?? 0) + 1}/${p.partsTotal}`
      : ''
  if (!p.indeterminate && typeof p.percent === 'number' && typeof p.contentLength === 'number') {
    return `${formatDlBytes(p.bytesPart ?? 0)} / ${formatDlBytes(p.contentLength)}（${p.percent}%）${part}`
  }
  return `已下载 ${formatDlBytes(p.bytesTotal ?? p.bytesPart ?? 0)}${part}`
}

const liveDownloadBar = computed(() => {
  if (!agentRunning.value || !active.value) return null
  for (let i = active.value.messages.length - 1; i >= 0; i--) {
    const m = active.value.messages[i]
    const p = toolDownloadProgress(m)
    if (!p) continue
    return {
      indeterminate: p.indeterminate === true,
      percent: p.percent,
      label: toolDownloadProgressLabel(m),
    }
  }
  // Fallback: phase text already says 下载中… even if meta is lagging.
  const detail = String(phaseDetail.value || '')
  if (/下载中/.test(detail)) {
    return { indeterminate: true, percent: undefined, label: detail }
  }
  return null
})

const elapsedLabel = computed(() => {
  if (!agentRunning.value || !runStartedAt.value) return ''
  const sec = Math.max(0, Math.floor((nowTick.value - runStartedAt.value) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
})

function roleLabel(role: string) {
  if (role === 'user') return '你'
  if (role === 'assistant') return 'Navora'
  if (role === 'log') return '日志'
  if (role === 'tool') return '工具'
  return role
}

function formatElapsedFull(ms: number): string {
  if (ms < 1000) return `耗时 ${ms} ms`
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `耗时 ${h} 小时 ${m} 分 ${s} 秒`
  if (m > 0) return `耗时 ${m} 分 ${s} 秒`
  return `耗时 ${s} 秒`
}

/** Final assistant reply duration for this Agent turn (stored or estimated). */
function assistantDurationMs(msg: ChatMessage): number | null {
  if (msg.role !== 'assistant') return null
  if (msg.meta?.partial) return null
  const stored = msg.meta?.durationMs
  if (typeof stored === 'number' && Number.isFinite(stored) && stored >= 0) {
    return stored
  }
  const msgs = active.value?.messages || []
  const idx = msgs.findIndex((m) => m.id === msg.id)
  if (idx <= 0) return null
  for (let i = idx - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      const d = msg.createdAt - msgs[i].createdAt
      return d >= 0 ? d : null
    }
  }
  return null
}

function assistantElapsedLabel(msg: ChatMessage): string {
  const ms = assistantDurationMs(msg)
  return ms == null ? '' : formatElapsedFull(ms)
}

function toolDisplay(m: ChatMessage): ToolDisplayInfo {
  const toolName = typeof m.meta?.toolName === 'string' ? m.meta.toolName : ''
  if(toolName==='agent_await_subchats')return {...resolveToolDisplay(toolName),label:'等待子任务',icon:'clock'}
  if(toolName==='agent_subchat_status')return {...resolveToolDisplay(toolName),label:'子任务进展',icon:'robot'}
  const pluginId = typeof m.meta?.pluginId === 'string' ? m.meta.pluginId : undefined
  const fromPlugin = m.meta?.fromPlugin === true
  return resolveToolDisplay(toolName, { pluginId, fromPlugin })
}

function toolMediaPath(m: ChatMessage): string | null {
  return extractImagePathFromToolResult(m.meta?.result)
}

async function hydrateToolMedia(m: ChatMessage, chatId: string): Promise<void> {
  const rel = toolMediaPath(m)
  if (!rel || !chatId) return
  if (toolMediaSrc.value[m.id]) return
  const url = await resolveWorkspaceMediaUrl(chatId, rel)
  if (!url) return
  toolMediaSrc.value = { ...toolMediaSrc.value, [m.id]: url }
}

async function hydrateActiveToolMedia(): Promise<void> {
  const chatId = activeId.value
  const msgs = active.value?.messages || []
  if (!chatId) return
  await Promise.all(msgs.filter((m) => m.role === 'tool').map((m) => hydrateToolMedia(m, chatId)))
}

function openToolMedia(message:ChatMessage){const path=toolMediaPath(message);if(path)openFilePreview(path);else openLightbox(toolMediaSrc.value[message.id]||'')}
function openLightbox(src: string, alt = '') {
  if (!src) return
  lightbox.value = { src, alt }
}

function closeLightbox() {
  lightbox.value = { src: '', alt: '' }
}

function messageSources(m: ChatMessage): AnswerSource[] {
  const raw = m.meta?.sources
  if (Array.isArray(raw) && raw.length) {
    const out: AnswerSource[] = []
    for (const s of raw) {
      if (!s || typeof s !== 'object') continue
      const item = s as AnswerSource
      const url = String(item.url || '').trim()
      if (!/^https?:\/\//i.test(url)) continue
      const title = String(item.title || '').trim()
      const siteName = String(item.siteName || siteNameFromUrl(url) || '').trim()
      let snippet = String(item.snippet || '').trim()
      // Soft-clean legacy snippets that stored raw JSON / JS.
      if (snippet) {
        const cleaned = makeSnippet(snippet)
        snippet = cleaned || ''
      }
      const readAt = typeof item.readAt === 'number' ? item.readAt : undefined
      const favicon = String(item.favicon || faviconForUrl(url) || '').trim()
      out.push({
        url,
        title: title || undefined,
        siteName: siteName || undefined,
        snippet: snippet || undefined,
        readAt,
        favicon: favicon || undefined,
      })
    }
    return out
  }
  if (m.role === 'assistant') return parseSourcesFromMarkdown(m.content || '')
  return []
}

function displayMessageContent(m: ChatMessage): string {
  if (m.role === 'assistant' && showReadPages.value && messageSources(m).length) {
    return stripTrailingSourcesSection(m.content || '')
  }
  return m.content || ''
}

function hostOf(url: string): string {
  return siteNameFromUrl(url) || url
}

function faviconFallback(url: string): string {
  return faviconForUrl(url)
}

function onFaviconError(e: Event) {
  const img = e.target as HTMLImageElement | null
  if (!img) return
  img.style.visibility = 'hidden'
}

function toggleReadPagesPanel(messageId: string, list: AnswerSource[]) {
  if (readPagesPanelOpen.value && readPagesPanelFromId.value === messageId) {
    closeReadPagesPanel()
    return
  }
  readPagesPanelFromId.value = messageId
  readSourcesPage.value = 0
  readPagesPanelList.value = list
  readPagesPanelOpen.value = true
}

function onReadPagesDialog(open: boolean) {
  if (!open) closeReadPagesPanel()
}

function closeReadPagesPanel() {
  readPagesPanelOpen.value = false
  readPagesPanelFromId.value = null
}

function openSourceUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return
  void appLinks.openLink(url,activeId.value||undefined)
}

function friendlyToolName(name: string) {
  const map: Record<string, string> = {
    agent_ask_user: '询问你',
    agent_ask_form: '填写问卷',
    agent_spawn_subchat: '启动子对话',
    agent_await_subchats: '等待子对话',
    agent_subchat_status: '子对话状态',
    datetime_now: '获取时间',
    weather_get: '查询天气',
    geolocation_get: '获取位置',
    browser_open: '打开浏览',
    browser_session_create: '创建 Session',
    browser_session_close: '关闭 Session',
    browser_session_clear: '清空 Session',
    browser_session_set_proxy: '设置代理',
    browser_session_set_ua: '设置 UA',
    browser_session_fetch: 'Session 请求',
    browser_window_create: '创建窗口',
    browser_window_close: '关闭窗口',
    browser_window_set_visible: '显隐窗口',
    browser_window_set_bounds: '调整窗口大小',
    browser_window_focus: '聚焦窗口',
    browser_navigate: '页面导航',
    browser_load_url_with_response: '加载自定义文档',
    browser_back: '后退',
    browser_forward: '前进',
    browser_reload: '刷新',
    browser_wait: '等待条件',
    browser_flow: '页面流程',
    browser_click: '点击元素',
    browser_hover: '悬停',
    browser_scroll: '滚动',
    browser_type: '输入文本',
    browser_press: '按键',
    browser_select: '下拉选择',
    browser_upload: '上传文件',
    browser_find: '查找元素',
    browser_query_deep: '深度查询元素',
    browser_dialog: '对话框',
    browser_get: '读取页面',
    browser_screenshot: '页面截图',
    desktop_screenshot: '桌面截图',
    browser_evaluate: '执行脚本',
    browser_cookies_get: '读取 Cookies',
    browser_cookies_set: '写入 Cookies',
    browser_cookies_remove: '删除 Cookies',
    browser_network_rule_add: '添加网络规则',
    browser_network_rule_remove: '移除网络规则',
    browser_network_rule_list: '列出网络规则',
    browser_network_log: '查看网络日志',
    browser_network_clear: '清空网络规则',
    browser_list_resources: '列出资源',
    workspace_info: '工作区信息',
    workspace_set: '设置工作区',
    file_list: '列出文件',
    file_stat: '文件信息',
    file_read: '读取文件',
    file_write: '写入文件',
    file_mkdir: '创建目录',
    file_delete: '删除文件',
    file_move: '移动文件',
    file_copy: '复制文件',
    file_concat: '拼接文件',
    file_download: '主动下载',
    file_download_compose: '组合下载',
    file_reveal: '资源管理器定位',
    file_open: '打开文件',
    shell_exec: '执行命令',
    app_settings_get: '查看设置',
    app_settings_update: '修改设置',
    app_models_list: '拉取模型列表',
    app_provider_add: '添加模型服务商',
    skill_list: '列出技能',
    skill_read: '读取技能',
    skill_create: '创建技能',
    skill_update: '更新技能',
    skill_delete: '删除技能',
    skill_export: '导出技能',
    plugin_list: '列出插件',
    plugin_read: '读取插件说明',
    plugin_build: '构建插件',
    plugin_pack: '打包插件',
    plugin_check: '检查插件',
    plugin_link: '外链插件',
    store_search: '搜索商店',
  }
  return map[name] || name
}

/** Collapsed tool row: friendly title (empty when unknown → show raw only). */
function toolHeadTitle(m: ChatMessage): string {
  const raw = String(m.meta?.toolName || '').trim()
  if (!raw) return ''
  if (raw === 'shell_exec') {
    const line = shellExecHeadline(m)
    if (line) return line
  }
  const friendly = friendlyToolName(raw)
  // No mapped title → leave title empty; raw id shows in tool-raw.
  if (friendly === raw) return ''
  return friendly
}

/** e.g. `dir /b` from shell_exec args. */
function shellExecHeadline(m: ChatMessage): string {
  const args = m.meta?.args
  if (!args || typeof args !== 'object') return ''
  const o = args as Record<string, unknown>
  const cmd = String(o.command || '').trim()
  if (!cmd) return ''
  const list = Array.isArray(o.args) ? o.args.map((a) => String(a)) : []
  const parts = [cmd, ...list].filter(Boolean)
  const line = parts.join(' ').trim()
  return line.length > 72 ? `${line.slice(0, 70)}…` : line
}

function effectiveToolStatus(m: ChatMessage): string {
  const status = String(m.meta?.status || 'unconfirmed')
  if (status === 'running' && !agentRunning.value) return 'unconfirmed'
  return status
}

function isMessageShimmer(m: ChatMessage): boolean {
  return Boolean(agentRunning.value && m.meta?.partial)
}

function clearLocalLoadingMarkers(chatId: string) {
  if (!active.value || active.value.id !== chatId) return
  let changed = false
  const next = active.value.messages.map((m) => {
    let meta = m.meta
    let content = m.content
    if (meta?.partial) {
      meta = { ...meta, phase: meta.phase || 'progress', partial: false }
      changed = true
    }
    if (m.role === 'tool' && meta?.status === 'running') {
      // The terminal event does not prove why an unfinished call ended.
      meta = { ...meta, status: 'unconfirmed' }
      if (content === '执行中…' || !String(content || '').trim()) content = '执行已结束，结果待确认'
      changed = true
    }
    if (meta === m.meta && content === m.content) return m
    return { ...m, content, meta }
  })
  if (changed) active.value = { ...active.value, messages: next }
}

function isActivityExpanded(id:string){return expandedTools.value[id]??!collapseToolRuns.value}
function toggleTool(id: string) {expandedTools.value = { ...expandedTools.value, [id]: !isActivityExpanded(id) }}

function isErrorRunLog(m: ChatMessage): boolean {
  return m.role === 'log' && logKindFromMeta(m.meta?.kind) === 'error'
}

/** Last user turn ended with agent_error or user stop (no newer user message after it). */
function lastUserTurnFailed(messages: ChatMessage[] | undefined | null): {
  failed: boolean
  summary?: string
  reason?: 'error' | 'stop'
} {
  if (!messages?.length) return { failed: false }
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx < 0) return { failed: false }
  const after = messages.slice(lastUserIdx + 1)
  const stopLog = [...after].reverse().find((m) => isStopRunLog(m))
  if (stopLog) {
    const summary =
      String(stopLog.meta?.summary || '').trim() ||
      logFullText(stopLog).split(/\r?\n/).find((l) => l.trim())?.trim() ||
      '用户终止'
    return { failed: true, summary, reason: 'stop' }
  }
  const errLog = [...after].reverse().find((m) => isErrorRunLog(m))
  if (!errLog) return { failed: false }
  const summary =
    String(errLog.meta?.summary || '').trim() ||
    logFullText(errLog).split(/\r?\n/).find((l) => l.trim())?.trim() ||
    '上次执行出错中断'
  return {
    failed: true,
    summary: summary === 'Agent 出错' ? '上次执行出错中断' : summary,
    reason: 'error',
  }
}

function isStopRunLog(m: ChatMessage): boolean {
  return m.role === 'log' && String(m.meta?.kind || '') === 'agent_stop'
}

function toggleLog(id: string) {
  if (!isLogExpanded(id) && !logCanExpandById(id)) return
  expandedLogs.value = { ...expandedLogs.value, [id]: !isLogExpanded(id) }
  void nextTick(() => {
    const el = logMeasureEls.get(id)
    const block = messageBlocks.value.find((b) => b.type === 'log' && b.message.id === id)
    if (el && block && block.type === 'log') measureLogOverflow(id, el, block.message)
  })
}

/** Expand/collapse only when not selecting text for copy. */
function onLogCardActivate(m: ChatMessage, ev?: Event) {
  if (!logCanExpand(m)) return
  if (typeof window !== 'undefined') {
    const sel = window.getSelection()
    if (sel && String(sel).length > 0) return
  }
  if (ev && 'detail' in ev && Number((ev as MouseEvent).detail) === 0) {
    /* keyboard */
  }
  toggleLog(m.id)
}

function isLogExpanded(id: string): boolean {
  return expandedLogs.value[id] === true
}

function logFullText(m: ChatMessage): string {
  const v = resolveRunLogView({
    content: m.content,
    summary: m.meta?.summary,
    detail: m.meta?.detail,
  })
  return v.detail ? `${v.summary}\n${v.detail}` : v.summary
}

function logCanExpandById(id: string): boolean {
  const block = messageBlocks.value.find((b) => b.type === 'log' && b.message.id === id)
  if (!block || block.type !== 'log') return false
  return logCanExpand(block.message)
}

function logCanExpand(m: ChatMessage): boolean {
  if (isLogExpanded(m.id)) return true
  const text = logFullText(m)
  if (text.includes('\n')) return true
  // Fallback when layout measure hasn't run / failed but text is clearly long.
  if (text.replace(/\s+/g, '').length >= 24) return true
  return logOverflowById.value[m.id] === true
}

function resolveLogEl(el: unknown): HTMLElement | null {
  if (!el) return null
  if (el instanceof HTMLElement) return el
  if (typeof el === 'object' && el && '$el' in el) {
    const nested = (el as { $el: unknown }).$el
    return nested instanceof HTMLElement ? nested : null
  }
  return null
}

function readTextOverflow(node: HTMLElement): boolean {
  // Measure under one-line clamp even if currently expanded.
  const prev = {
    overflow: node.style.overflow,
    textOverflow: node.style.textOverflow,
    whiteSpace: node.style.whiteSpace,
  }
  node.style.overflow = 'hidden'
  node.style.textOverflow = 'ellipsis'
  node.style.whiteSpace = 'nowrap'
  const overflowing = node.scrollWidth > node.clientWidth + 1
  node.style.overflow = prev.overflow
  node.style.textOverflow = prev.textOverflow
  node.style.whiteSpace = prev.whiteSpace
  return overflowing
}

function measureLogOverflow(id: string, el: unknown, m: ChatMessage) {
  const node = resolveLogEl(el)
  if (!node) {
    logMeasureEls.delete(id)
    logResizeObservers.get(id)?.disconnect()
    logResizeObservers.delete(id)
    return
  }
  logMeasureEls.set(id, node)

  const run = () => {
    const text = logFullText(m)
    const next = text.includes('\n') || readTextOverflow(node)
    if (logOverflowById.value[id] !== next) {
      logOverflowById.value = { ...logOverflowById.value, [id]: next }
    }
  }

  let ro = logResizeObservers.get(id)
  if (!ro) {
    ro = new ResizeObserver(() => run())
    logResizeObservers.set(id, ro)
  }
  ro.disconnect()
  ro.observe(node)
  if (node.parentElement) ro.observe(node.parentElement)

  requestAnimationFrame(() => requestAnimationFrame(run))
}

function remeasureAllLogOverflow() {
  for (const [id, el] of logMeasureEls) {
    const block = messageBlocks.value.find((b) => b.type === 'log' && b.message.id === id)
    if (block && block.type === 'log') measureLogOverflow(id, el, block.message)
  }
}

function logToneClass(m: ChatMessage): string {
  return `tone-${logKindFromMeta(m.meta?.kind)}`
}

function logKindText(m: ChatMessage): string {
  return logKindLabel(logKindFromMeta(m.meta?.kind) as LogKindTone)
}

function upsertMessage(msg: ChatMessage) {
  if (!active.value) return
  const idx = active.value.messages.findIndex((m) => m.id === msg.id)
  if (idx === -1) {
    active.value = {
      ...active.value,
      messages: [...active.value.messages, msg],
      updatedAt: msg.createdAt,
    }
  } else {
    const next = active.value.messages.slice()
    next[idx] = msg
    active.value = { ...active.value, messages: next, updatedAt: Date.now() }
  }
}

function setRunning(chatId: string, running: boolean) {
  runningChats.value = { ...runningChats.value, [chatId]: running }
  if (running) {
    const nextErr = { ...chatErrors.value }
    delete nextErr[chatId]
    chatErrors.value = nextErr
  }
  if (!running) {
    const next = { ...phaseByChat.value }
    delete next[chatId]
    phaseByChat.value = next
    const liveNext = { ...liveReasoningByChat.value }
    delete liveNext[chatId]
    liveReasoningByChat.value = liveNext
    const forcedNext = { ...liveReasoningForced.value }
    delete forcedNext[chatId]
    liveReasoningForced.value = forcedNext
    clearLocalLoadingMarkers(chatId)
  }
  if (chatId === activeId.value) {
    agentRunning.value = running
    if (running) {
      runStartedAt.value = Date.now()
      nowTick.value = Date.now()
    } else {
      phase.value = 'idle'
      phaseDetail.value = ''
    }
  }
}

type ChatListStatus = {
  icon: string
  tone: 'running' | 'ask' | 'perm' | 'error' | 'key' | 'stopped'
  title: string
  spin?: boolean
}

function formatAgentError(raw: string): { message: string; code?: string } {
  const s = String(raw || '').trim()
  if (!s) return { message: 'Agent 出错' }
  if (
    s === 'user_stopped' ||
    s.startsWith('user_stopped:') ||
    s === '用户终止' ||
    s.startsWith('用户终止') ||
    s === 'aborted' ||
    s === '已取消'
  ) {
    const msg = s.startsWith('user_stopped:')
      ? s.slice('user_stopped:'.length).trim()
      : s.startsWith('用户终止')
        ? '用户终止'
        : ''
    return {
      code: 'user_stopped',
      message: msg || (s === '已取消' ? '已取消' : '用户终止'),
    }
  }
  if (s.startsWith('api_key_missing')) {
    const msg = s.includes(':') ? s.slice(s.indexOf(':') + 1).trim() : ''
    return {
      code: 'api_key_missing',
      message: msg || '请在设置 → 模型中填写并保存 API Key',
    }
  }
  if (s === 'agent_already_running') {
    return { code: 'agent_already_running', message: '该会话 Agent 正在运行' }
  }
  if (s === 'app_closing') {
    return { code: 'app_closing', message: '程序正在退出，任务已保留，请稍后再试' }
  }
  if (s === 'max_parallel_agent_chats') {
    return { code: 'max_parallel_agent_chats', message: '并行 Agent 数量已达上限' }
  }
  if (s === 'max_subchats') {
    return { code: 'max_subchats', message: '并行子对话数量已达上限' }
  }
  if (s === 'subchat_disabled') {
    return { code: 'subchat_disabled', message: '子对话已在设置中关闭' }
  }
  if (s === 'nothing_to_retry') {
    return { code: 'nothing_to_retry', message: '没有可重试的提问' }
  }
  if (s === 'provider_not_configured' || s.startsWith('provider_not_configured')) {
    const msg = s.includes(':') ? s.slice(s.indexOf(':') + 1).trim() : ''
    return {
      code: 'provider_not_configured',
      message: msg || '请先在设置中配置模型服务商',
    }
  }
  const idx = s.indexOf(':')
  if (idx > 0 && /^[a-z][a-z0-9_]*$/i.test(s.slice(0, idx))) {
    return { code: s.slice(0, idx), message: s.slice(idx + 1).trim() || s }
  }
  return { message: s }
}

function rememberChatError(chatId: string, raw: string) {
  chatErrors.value = { ...chatErrors.value, [chatId]: formatAgentError(raw) }
}

function clearChatError(chatId: string) {
  if (!chatErrors.value[chatId]) return
  const next = { ...chatErrors.value }
  delete next[chatId]
  chatErrors.value = next
}

function chatListStatus(chatId: string): ChatListStatus | null {
  if(pendingQuestionnaireForSidebar(chatId))return {icon:'circle-question',tone:'ask',title:'问卷待填写'}
  if (runningChats.value[chatId]) {
    const ph = phaseByChat.value[chatId]?.phase
    if (ph === 'awaiting_permission') {
      return { icon: 'shield-halved', tone: 'perm', title: '等待权限确认' }
    }
    if (ph === 'awaiting_user' || pendingAsks.value[chatId]) {
      return { icon: 'circle-question', tone: 'ask', title: '等待你的选择' }
    }
    return { icon: 'circle-notch', tone: 'running', title: 'Agent 运行中', spin: true }
  }
  const bubbledAsk = pendingAskForSidebar(chatId)
  if (bubbledAsk) {
    const fromSub = bubbledAsk.chatId !== chatId
    const badge = pendingAskBadge(bubbledAsk.chatId)
    return {
      icon: 'circle-question',
      tone: 'ask',
      title: fromSub
        ? `子任务${badge ? `：${badge}` : '询问/决策'}`
        : badge
          ? badge
          : '询问/决策',
    }
  }
  if (
    chats.value.some(
      (c) => c.kind === 'sub' && c.parentChatId === chatId && runningChats.value[c.id],
    )
  ) {
    return { icon: 'circle-notch', tone: 'running', title: '子任务运行中', spin: true }
  }
  const err = chatErrors.value[chatId]
  if (err) {
    if (err.code === 'user_stopped') {
      return { icon: 'stop', tone: 'stopped', title: err.message || '用户终止' }
    }
    if (err.code === 'api_key_missing') {
      return { icon: 'key', tone: 'key', title: err.message }
    }
    return { icon: 'circle-exclamation', tone: 'error', title: err.message }
  }
  const chat = chats.value.find((c) => c.id === chatId)
  if (chat?.spawnStatus === 'cancelled') {
    return { icon: 'stop', tone: 'stopped', title: '已取消' }
  }
  return null
}

/** Pending ask on this chat, or bubbled from a child sub-chat. */
function pendingAskForSidebar(chatId: string): AgentAskRequest | null {
  const own = pendingAsks.value[chatId]
  if (own) return own
  for (const req of Object.values(pendingAsks.value)) {
    if (req.parentChatId === chatId) return req
  }
  for (const c of chats.value) {
    if (c.kind === 'sub' && c.parentChatId === chatId && pendingAsks.value[c.id]) {
      return pendingAsks.value[c.id]
    }
  }
  return null
}

function isSubchatSpawnTool(m: ChatMessage): boolean {
  return m.role === 'tool' && String(m.meta?.toolName || '') === 'agent_spawn_subchat'
}

function spawnSubChatId(m: ChatMessage): string {
  const fromMeta = String(m.meta?.subChatId || '').trim()
  if (fromMeta) return fromMeta
  const result = m.meta?.result
  if (result && typeof result === 'object' && 'subChatId' in result) {
    return String((result as { subChatId?: string }).subChatId || '').trim()
  }
  return ''
}

function isSpawnSubchatDeleted(m: ChatMessage): boolean {
  const id = spawnSubChatId(m)
  if (!id) return false
  return !chats.value.some((c) => c.id === id)
}

function spawnStatusOf(m: ChatMessage): import('@shared/types').SubChatRunStatus|undefined {
  if (isSpawnSubchatDeleted(m)) return undefined
  const current=chats.value.find(chat=>chat.id===spawnSubChatId(m))
  if(current?.subchatRun?.status)return current.subchatRun.status
  const fromMeta = String(m.meta?.spawnStatus || '').trim()
  if (['running','done','failed','cancelled','interrupted'].includes(fromMeta)) return fromMeta as import('@shared/types').SubChatRunStatus
  const result = m.meta?.result
  if (result && typeof result === 'object' && 'status' in result) {
    const status=String((result as { status?: string }).status || '').trim()
    return ['running','done','failed','cancelled','interrupted'].includes(status)?status as import('@shared/types').SubChatRunStatus:'running'
  }
  return 'running'
}

function spawnGoalOf(m: ChatMessage): string {
  const g = String(m.meta?.spawnGoal || '').trim()
  if (g) return normalizeTitleText(g)
  const args = m.meta?.args
  if (args && typeof args === 'object' && 'goal' in args) {
    return normalizeTitleText(String((args as { goal?: string }).goal || ''))
  }
  return ''
}

function spawnGoalLabel(m: ChatMessage): string {
  const child=chats.value.find(chat=>chat.id===spawnSubChatId(m))
  return child?displaySubchatTitle(child):spawnGoalOf(m) || '子对话'
}

const chatStatusById = computed(() => {
  const map: Record<string, ChatListStatus> = {}
  for (const c of chats.value) {
    const st = chatListStatus(c.id)
    if (st) map[c.id] = st
  }
  return map
})

function onChatStatusClick(chatId: string) {
  const st = chatListStatus(chatId)
  if (!st) return
  if (st.tone === 'ask') {
    void openPendingAsk(chatId)
    return
  }
  if (st.tone === 'perm') {
    if (activeId.value !== chatId) void selectChat(chatId)
    else scrollToInlineDecision()
    return
  }
  if (st.tone === 'running' && !runningChats.value[chatId]) {
    // Parent showing bubbled child running — open first running child if any.
    const child = chats.value.find(
      (c) => c.kind === 'sub' && c.parentChatId === chatId && runningChats.value[c.id],
    )
    if (child) void selectChat(child.id)
    return
  }
  if (st.tone === 'key' || st.tone === 'error' || st.tone === 'stopped') {
    showToast(st.title, st.tone === 'key' ? 'warning' : st.tone === 'stopped' ? 'info' : 'error')
    if (st.tone === 'key' || st.title.includes('API Key') || st.title.includes('设置')) {
      void openSettings('model')
    }
  }
}

function chatSwipeTrackStyle(chatId: string): Record<string, string> | undefined {
  if (!isMobileLayout.value) return undefined
  let x = 0
  if (chatSwipeDragId.value === chatId) x = chatSwipeOffset.value
  else if (chatSwipeOpenId.value === chatId) x = -CHAT_SWIPE_ACTION_W
  if (!x && chatSwipeOpenId.value !== chatId && chatSwipeDragId.value !== chatId) return undefined
  return { transform: `translate3d(${x}px,0,0)` }
}

function closeChatSwipe() {
  chatSwipeOpenId.value = null
  chatSwipeDragId.value = null
  chatSwipeOffset.value = 0
  chatSwipeLockedH.value = false
  chatSwipeAxis = null
}

function onChatTouchStart(e: TouchEvent, chatId: string) {
  if (!isMobileLayout.value) return
  if (renamingChatId.value) return
  const t = e.touches[0]
  if (!t) return
  if (chatSwipeOpenId.value && chatSwipeOpenId.value !== chatId) {
    chatSwipeOpenId.value = null
  }
  chatSwipeStartX = t.clientX
  chatSwipeStartY = t.clientY
  chatSwipeAxis = null
  chatSwipeLockedH.value = false
  chatSwipeDragId.value = chatId
  chatSwipeBaseOffset = chatSwipeOpenId.value === chatId ? -CHAT_SWIPE_ACTION_W : 0
  chatSwipeOffset.value = chatSwipeBaseOffset
}

function onChatTouchMove(e: TouchEvent, chatId: string) {
  if (!isMobileLayout.value || chatSwipeDragId.value !== chatId) return
  const t = e.touches[0]
  if (!t) return
  const dx = t.clientX - chatSwipeStartX
  const dy = t.clientY - chatSwipeStartY
  if (!chatSwipeAxis) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    chatSwipeAxis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
    if (chatSwipeAxis === 'v') {
      chatSwipeDragId.value = null
      chatSwipeLockedH.value = false
      chatSwipeOffset.value = 0
      return
    }
    chatSwipeLockedH.value = true
  }
  if (chatSwipeAxis !== 'h') return
  if (e.cancelable) e.preventDefault()
  chatSwipeOffset.value = Math.min(0, Math.max(-CHAT_SWIPE_ACTION_W, chatSwipeBaseOffset + dx))
}

function onChatTouchEnd(chatId: string) {
  if (chatSwipeDragId.value !== chatId) return
  const wasHorizontal = chatSwipeAxis === 'h'
  const open = chatSwipeOffset.value <= -CHAT_SWIPE_ACTION_W * 0.45
  chatSwipeOpenId.value = open ? chatId : null
  chatSwipeDragId.value = null
  chatSwipeLockedH.value = false
  chatSwipeOffset.value = 0
  chatSwipeAxis = null
  if (wasHorizontal) {
    chatSwipeSuppressClick = true
    if (chatSwipeSuppressTimer) clearTimeout(chatSwipeSuppressTimer)
    chatSwipeSuppressTimer = setTimeout(() => {
      chatSwipeSuppressClick = false
      chatSwipeSuppressTimer = undefined
    }, 320)
  }
}

function onChatItemActivate(chatId: string) {
  if (renamingChatId.value === chatId) return
  if (chatBatchMode.value) {
    toggleBatchSelect(chatId)
    return
  }
  if (chatSwipeSuppressClick) return
  if (isMobileLayout.value) {
    if (chatSwipeOpenId.value === chatId) {
      closeChatSwipe()
      return
    }
    if (chatSwipeOpenId.value) closeChatSwipe()
  }
  if (renamingChatId.value && renamingChatId.value !== chatId) cancelRenameChat()
  void selectChat(chatId)
}

function enterChatBatchMode() {
  chatBatchMode.value = true
  batchSelectedIds.value = new Set()
  closeChatSwipe()
  chatMoreOpenId.value = null
  cancelRenameChat()
}

function exitChatBatchMode() {
  chatBatchMode.value = false
  batchSelectedIds.value = new Set()
}

function toggleBatchSelect(chatId: string) {
  const next = new Set(batchSelectedIds.value)
  if (next.has(chatId)) next.delete(chatId)
  else next.add(chatId)
  batchSelectedIds.value = next
}

function toggleBatchSelectAll() {
  if (batchAllSelected.value) {
    batchSelectedIds.value = new Set()
    return
  }
  batchSelectedIds.value = new Set(
    chats.value.filter((c) => c.kind !== 'sub').map((c) => c.id),
  )
}

function askBatchDeleteChats() {
  if (!batchSelectedCount.value) return
  deleteTarget.value = null
  deleteBatchIds.value = [...batchSelectedIds.value]
  deleteDialog.value = true
}

async function batchPinSelected() {
  if (!window.navora || !batchSelectedCount.value || batchPinning.value) return
  const pin = !batchSelectionAllPinned.value
  batchPinning.value = true
  try {
    for (const id of batchSelectedIds.value) {
      await window.navora.chats.setPinned(id, pin)
    }
    await refreshList()
    showToast(pin ? `已置顶 ${batchSelectedCount.value} 个对话` : `已取消置顶 ${batchSelectedCount.value} 个对话`, 'primary')
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : pin ? '批量置顶失败' : '取消置顶失败')
  } finally {
    batchPinning.value = false
  }
}

watch(chats, (list) => {
  if (!list.length && chatBatchMode.value) {
    exitChatBatchMode()
    return
  }
  if (!chatBatchMode.value || !batchSelectedIds.value.size) return
  const alive = new Set(list.map((c) => c.id))
  let changed = false
  const next = new Set<string>()
  for (const id of batchSelectedIds.value) {
    if (alive.has(id)) next.add(id)
    else changed = true
  }
  if (changed) batchSelectedIds.value = next
})

const dateFormatter = new Intl.DateTimeFormat()
const timestampFormatter = new Intl.DateTimeFormat(undefined, {year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'})
function formatTime(ts: number) {
  try {
    return timestampFormatter.format(ts)
  } catch {
    return ''
  }
}

function formatRelative(ts: number) {
  const diff = Math.max(0, Date.now() - ts)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  try {
    return dateFormatter.format(ts)
  } catch {
    return ''
  }
}

function resumeMessageFollow(){
  messageReadingIntent=false;userMessageScroll=false;userMessageScrollPending=false;stickToBottom.value=true
}
function onMessagesScrollInput(event:Event){
  const box=msgBox.value
  if(!box)return
  if(event instanceof KeyboardEvent){
    if(!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return
    if((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]'))return
  }else if(event instanceof PointerEvent){
    // A press in the native scrollbar starts a real scroll gesture. Clicking a
    // message or a control must not turn a later layout event into user input.
    const bounds=box.getBoundingClientRect(),x=event.clientX-bounds.left
    if(event.target!==box||x>=box.clientLeft&&x<box.clientLeft+box.clientWidth)return
  }else if(event instanceof WheelEvent&&!event.deltaX&&!event.deltaY)return
  userMessageScroll=true;userMessageScrollPending=true
  cancelMessageJump()
}
function onOutlineNavigate(){
  cancelMessageJump()
  messageReadingIntent=true;userMessageScroll=true;userMessageScrollPending=true;stickToBottom.value=false
  requestAnimationFrame(onMessagesScroll)
}
function onMessagesScrollEnd(){
  if(userMessageScroll){
    const box=msgBox.value
    // A new key/wheel gesture can arrive before the previous smooth scroll's
    // queued scrollend. That old end must not discard the new input intent.
    if(userMessageScrollPending&&box&&box.scrollHeight-box.clientHeight-box.scrollTop>=80)return
    onMessagesScroll()
  }
  userMessageScroll=false;userMessageScrollPending=false
}
function onMessagesScroll() {
  if(!conversationIsVisible.value||restoringConversation||messageJumpInProgress)return
  const el = msgBox.value
  if (!el?.checkVisibility()) return
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  // Scroll events also arrive after native navigation and scroll anchoring.
  // Only a real scrolling gesture can resume following an explicit read.
  if(userMessageScroll){userMessageScrollPending=false;messageReadingIntent=dist>=80;stickToBottom.value=dist<80}
  else if(!messageReadingIntent)stickToBottom.value=dist<80
  showJumpBottom.value = !stickToBottom.value && el.scrollHeight > el.clientHeight + 40
  if(activeId.value)conversationReading={chatId:activeId.value,top:el.scrollTop,follow:stickToBottom.value}
}

async function scrollMessages(force = false) {
  if(!conversationIsVisible.value||restoringConversation||messageJumpInProgress||messageReadingIntent)return
  const version=conversationScrollVersion,chatId=activeId.value
  if(conversationFind.value?.opened){showJumpBottom.value=true;return}
  await nextTick()
  if (!msgBox.value?.checkVisibility()||!conversationIsVisible.value||restoringConversation||messageJumpInProgress||messageReadingIntent||version!==conversationScrollVersion||chatId!==activeId.value) return
  if (!force && !stickToBottom.value) {
    showJumpBottom.value = true
    return
  }
  const last=msgBox.value.lastElementChild
  if(last instanceof HTMLElement)positionMessageInScroller(last,msgBox.value,'end')
  msgBox.value.scrollTop = msgBox.value.scrollHeight
  resumeMessageFollow()
  showJumpBottom.value = false
  if(chatId)conversationReading={chatId,top:msgBox.value.scrollTop,follow:true}
}

function jumpToBottom() {
  cancelMessageJump()
  conversationFind.value?.close()
  resumeMessageFollow()
  void scrollMessages(true)
}

function focusComposer() {
  // Mobile: avoid auto-focus so the soft keyboard does not pop open unexpectedly.
  if (isMobileLayout.value) return
  void nextTick(() => {
    const field = draftField.value as unknown as { focus?: () => void; $el?: HTMLElement } | null
    if (field?.focus) {
      field.focus()
      return
    }
    const el = (field as { $el?: HTMLElement } | null)?.$el?.querySelector?.('textarea') as
      | HTMLTextAreaElement
      | undefined
    el?.focus()
  })
}

function clampDraftText(text:string):string{return text}
function applyDraftLocally(text:string,touchedAt:number,document?:ComposerDocument){draftState.applyText(text,touchedAt,document)}
function scheduleDraftSave(){draftState.schedule()}
async function flushDraftSave(chatId?:string|null){await draftState.flush(chatId??activeId.value)}

const contextPreviews=ref<Record<string,string>>({})
let previewGeneration=0
let previewSourceKeys=new Map<string,string>()
watch(()=>[activeId.value,composerDocument.value.id,previewComposerDocument(composerDocument.value).contexts.filter(item=>item.block.source.kind==='image').map(item=>`${item.block.id}:${item.block.source.path}:${item.block.version}`).join('|')],async()=>{
  const request=++previewGeneration,chatId=activeId.value,documentId=composerDocument.value.id
  if(!chatId)return
  const blocks=previewComposerDocument(composerDocument.value).contexts.filter(item=>item.block.source.kind==='image'&&item.block.source.path).slice(0,8)
  const keys=new Map(blocks.map(item=>[item.block.id,`${chatId}:${item.block.source.path}:${item.block.version}`]))
  contextPreviews.value=Object.fromEntries(Object.entries(contextPreviews.value).filter(([id])=>keys.has(id)&&keys.get(id)===previewSourceKeys.get(id)));previewSourceKeys=keys
  await Promise.allSettled(blocks.filter(item=>!contextPreviews.value[item.block.id]).map(async item=>{
    const result=await window.navora?.workspace.preview(chatId,item.block.source.path!)
    if(request!==previewGeneration||activeId.value!==chatId||composerDocument.value.id!==documentId||!result?.ok||!result.base64||!/^image\/(png|jpeg|webp|gif)$/.test(result.mime||''))return
    contextPreviews.value={...contextPreviews.value,[item.block.id]:`data:${result.mime};base64,${result.base64}`}
  }))
})
let sourceSelection:{chatId:string;documentId:string;bookmark:ComposerSelectionBookmark|null}|null=null
function captureComposerSelection(){sourceSelection={chatId:activeId.value||'',documentId:composerDocument.value.id,bookmark:draftField.value?.saveSelection()||null}}
async function openContextPicker(source='file',files?:File[],replacement?:ComposerContextBlock){
  if(!activeId.value)return
  if(!sourceSelection||sourceSelection.chatId!==activeId.value||sourceSelection.documentId!==composerDocument.value.id)captureComposerSelection()
  const anchor=document.querySelector<HTMLElement>('.composer-box')
  if(anchor)await attachmentMenu.value?.showSource(anchor,source,replacement,files)
}
function openAttachmentMenu(){captureComposerSelection();const anchor=document.querySelector<HTMLElement>('.composer-box');if(anchor)attachmentMenu.value?.show(anchor)}
function onAttachRequest(request?:{source?:string;files?:File[]}){captureComposerSelection();if(request?.source||request?.files?.length)void openContextPicker(request?.source||'file',request?.files);else openAttachmentMenu()}
const selectedTaskDeclarations=computed(()=>{try{return normalizeTaskDeclarations(composerDocument.value.declarations).ids}catch{return []}})
function selectTaskDeclaration(id:TaskDeclarationId){const selection=sourceSelection;if(!selection||selection.chatId!==activeId.value||selection.documentId!==composerDocument.value.id){showToast('草稿已切换，请重新选择声明。','warning');return}if(selection.bookmark)draftField.value?.restoreSelection(selection.bookmark);draftField.value?.toggleDeclaration(id);sourceSelection=null}
function selectAttachmentSource(source:string){draftField.value?.consumeAttachmentTrigger();captureComposerSelection();void openContextPicker(source)}
function createFromAttachment(kind:CreatorKind){draftField.value?.consumeAttachmentTrigger();captureComposerSelection();openCreator(kind)}
function attachmentClosed(committed:boolean){if(!committed){draftField.value?.cancelAttachmentTrigger();closeContextPicker()}}
watch([activeId,()=>composerDocument.value.id],()=>attachmentMenu.value?.hide(false))
function closeContextPicker(){const selection=sourceSelection;sourceSelection=null;if(selection?.chatId===activeId.value&&selection.documentId===composerDocument.value.id&&selection.bookmark)draftField.value?.restoreSelection(selection.bookmark)}
function insertContextSources(items:ComposerSourceInsert[],replacementId?:string){
  const selection=sourceSelection;sourceSelection=null
  if(!selection||selection.chatId!==activeId.value||selection.documentId!==composerDocument.value.id){showToast('对话或草稿已切换，请重新选择插入位置。','warning');return}
  const editor=draftField.value;if(!editor)return
  if(!replacementId&&selection.bookmark&&!editor.restoreSelection(selection.bookmark)){showToast('原插入位置已变化，请重新选择位置。','warning');return}
  for(const item of items){
    const applied=replacementId?editor.updateContext(replacementId,{block:item.block,text:item.text||''}):editor.insertContext(item.block,item.text)
    if(!applied){showToast('来源块已变化，请重新选择。','warning');continue}
    const previews={...contextPreviews.value};delete previews[item.block.id];if(item.preview)previews[item.block.id]=item.preview;contextPreviews.value=previews
  }
  scheduleDraftSave();focusComposer()
}
async function openComposerSource(block:ComposerContextBlock){
  const source=block.source,chatId=source.chatId||activeId.value
  if(!chatId)return
  if(source.kind==='file'||source.kind==='image'){if(source.path)openFilePreview(source.path,chatId)}
  else if(source.kind==='message'&&source.messageId)await locateResourceMessage({chatId,messageId:source.messageId})
  else if(source.kind==='annotation')await window.navora?.browser.workspace.presentAnnotation(chatId,source.identity).catch(()=>showToast('标注来源已不可用。','warning'))
  else if(source.kind==='page'){
    try{await window.navora?.browser.workspace.command(source.browserRef?.windowId||source.identity,'focus')}catch{showToast('页面已关闭，请更换来源或使用保留的摘录。','warning')}
  }else if(source.kind==='url'&&source.url)await appLinks.openLink(source.url,chatId)
  else if(source.kind==='session')showResources('browser')
}
function sourceTab(block:ComposerContextBlock){if(block.source.identity.startsWith('skill:'))return 'skill';if(block.source.identity.startsWith('plugin:'))return 'plugin';return block.source.kind==='image'?'file':block.source.kind==='page'?'page':block.source.kind==='message'?'message':block.source.kind==='annotation'?'annotation':block.source.kind==='session'?'session':block.source.kind==='url'?'url':block.source.kind==='text'?'text':'file'}
function changeComposerSource(block:ComposerContextBlock){captureComposerSelection();void openContextPicker(sourceTab(block),undefined,block)}
function refreshComposerSource(block:ComposerContextBlock){showToast('重新选择来源并确认后才替换当前摘录，取消会保留编辑内容。','primary');changeComposerSource(block)}
function markBrowserSources(windowIds:Set<string>,sessionIds:Set<string>){
  let changed=false
  const map=(nodes:ComposerDocument['content']):ComposerDocument['content']=>nodes.map(node=>{
    if(node.type==='contextBlock'||node.type==='contextInline'){
      const block=node.attrs?.block as ComposerContextBlock|undefined,ref=block?.source.browserRef
      if(block&&ref){const valid=ref.kind==='session'?sessionIds.has(ref.sessionId):!!ref.windowId&&windowIds.has(ref.windowId),status=valid?block.status||'ready':block.mode==='excerpt'?'stale':'missing';if(block.status!==status){changed=true;return {...node,attrs:{...node.attrs,block:{...block,status}}}}}
    }
    return node.content?{...node,content:map(node.content)}:node
  })
  const content=map(composerDocument.value.content)
  if(changed)draftState.edited({...composerDocument.value,content,updatedAt:Date.now()})
}
async function recoverComposerDocument(document:ComposerDocument){
  if(document.chatId!==activeId.value){showToast('这份草稿属于其他对话，请切回原对话恢复。','warning');return false}
  const merged=mergeComposerDocuments(composerDocument.value,document)
  applyDraftLocally('',Date.now(),merged);scheduleDraftSave();focusComposer();return true
}

const applicationEdit=useApplicationEditTarget({nativePage:()=>activeFileTab.value?.kind==='browser'&&(fileWorkspaceVisible.value||browserWorkspaceActive.value)?activeFileTab.value.pageId:undefined,preview:()=>msgBox.value})
type ApplicationTarget=({kind:'composer';editor:ComposerEditorHandle;bookmark:ComposerSelectionBookmark|null}|{kind:'standard';bookmark:ReturnType<typeof applicationEdit.capture>}|{kind:'none'})&{browser?:{pageId:string;context?:BrowserPageAddressContext}}
const appMenu=ref<InstanceType<typeof ApplicationMenuBar>|null>(null),applicationFilePicker=ref(false),applicationVersion=ref(''),applicationTarget=ref<ApplicationTarget>({kind:'none'}),recentClosedCount=ref(0)
const windowFullscreen=ref(false)
let offWindowFullscreen:(()=>void)|undefined
onMounted(()=>{if(isWebRemote())return;void window.navora?.app.isFullscreen().then(state=>{windowFullscreen.value=state.fullscreen}).catch(()=>{});offWindowFullscreen=window.navora?.app.onFullscreen(value=>{windowFullscreen.value=value})})
onBeforeUnmount(()=>offWindowFullscreen?.())
function captureApplicationTarget(nativePageId?:string):ApplicationTarget{
  const state=(fileWorkspaceVisible.value||browserWorkspaceActive.value)?fileWorkspace.value?.browserApplicationState:null
  const browser=state?.pageId&&(!nativePageId||state.pageId===nativePageId)?{pageId:state.pageId,context:state.addressState.context?{...state.addressState.context}:undefined}:undefined
  const selection=window.getSelection(),anchor=selection?.anchorNode?.parentElement,focused=document.activeElement
  const editor=!nativePageId&&((focused instanceof Element&&focused.closest('[data-composer-editor]'))||(!selection?.isCollapsed&&anchor?.closest('[data-composer-editor]')))?captureActiveComposerEditor():null
  if(editor)return applicationTarget.value={kind:'composer',editor,bookmark:editor.saveSelection(),browser}
  return applicationTarget.value={kind:'standard',bookmark:applicationEdit.capture(nativePageId),browser}
}
function restoreApplicationTarget(value:unknown){
  const target=value as ApplicationTarget|undefined
  if(target?.kind==='composer')return target.editor.restoreSelection(target.bookmark||undefined)
  if(target?.kind==='standard')return applicationEdit.restore(target.bookmark)
  return false
}
function refreshApplicationTarget(nativePageId?:string){
  captureApplicationTarget(nativePageId)
  const id=activeId.value
  if(id&&!isWebRemote())void window.navora?.browser.workspace.tabState(id).then(state=>{if(activeId.value===id)recentClosedCount.value=state.recentlyClosed.length}).catch(()=>{recentClosedCount.value=0})
}
const applicationCommandState=computed<AppCommandStateMap>(()=>{
  const hasChat=!!activeId.value,reason=hasChat?undefined:'请先选择对话',target=applicationTarget.value,editor=target.kind==='composer'?target.editor.getCommandState():null,standard=target.kind==='standard'?applicationEdit.state.value:null
  const browser=(fileWorkspaceVisible.value||browserWorkspaceActive.value)?fileWorkspace.value?.browserApplicationState:null
  // Touch the active document so the next menu opening sees its latest command state.
  void composerDocument.value
  const scoped=(enabled:boolean,label?:string,checked?:boolean)=>({enabled:hasChat&&enabled,label,checked,reason:!hasChat?reason:!enabled?'当前内容不可用':undefined})
  return {
    'conversation.new':true,'browser.new':scoped(!isWebRemote()),'browser.reopen':scoped(!isWebRemote()&&recentClosedCount.value>0),'conversation.openFile':scoped(true),'conversation.openFolder':scoped(true),'conversation.export':scoped(!exportingChat.value),'content.close':{enabled:docsOpen.value||!!activeFileTab.value&&(fileWorkspaceVisible.value||browserWorkspaceActive.value)},
    'browser.copyUrl':{visible:!!browser,enabled:!!browser?.addressState.context,label:browser?.addressState.copyLabel,reason:browser?.addressState.reason},
    'browser.openExternal':{visible:!!browser?.addressState.visible,enabled:!!browser?.addressState.context&&!isWebRemote(),label:browser?.addressState.label,reason:browser?.addressState.reason},
    'browser.reload':{visible:!!browser,enabled:!!browser},'browser.reloadIgnoringCache':{visible:!!browser,enabled:!!browser},'browser.mute':{visible:!!browser,enabled:!!browser,checked:browser?.muted,label:browser?.muted?'取消页面静音':'静音当前页面'},
    'app.settings':true,'help.about':true,'app.quit':{enabled:!isWebRemote(),visible:!isWebRemote()},'view.fullscreen':{enabled:!isWebRemote(),visible:!isWebRemote(),label:windowFullscreen.value?'退出全屏':'进入全屏',checked:windowFullscreen.value},
    'edit.undo':{enabled:editor?.undo??standard?.undo??false,reason:'当前目标没有可撤销的编辑'},'edit.redo':{enabled:editor?.redo??standard?.redo??false,reason:'当前目标没有可重做的编辑'},'edit.cut':editor?.cut??standard?.cut??false,'edit.copy':editor?.copy??standard?.copy??false,'edit.paste':editor?.paste??standard?.paste??false,'edit.pastePlain':editor?.['paste-plain']??standard?.pastePlain??false,'edit.delete':editor?.delete??standard?.delete??false,'edit.selectAll':editor?.['select-all']??standard?.selectAll??false,
    'editor.link':{enabled:editor?.link||false,label:'添加／编辑链接…',reason:'请在消息编辑器中选择一段文字或定位到链接'},'editor.unlink':editor?.unlink||false,'editor.attach':scoped(!!editor?.attach),'conversation.search':true,'conversation.find':{enabled:docsOpen.value||hasChat,label:docsOpen.value?'搜索使用文档':undefined,reason:docsOpen.value?undefined:reason},
    'view.sidebar':{enabled:!settingsOpen.value&&!creatorKind.value,label:'显示侧栏',checked:!allSidebarHidden.value},'view.sidebarPinned':{enabled:!isMobileLayout.value&&!settingsOpen.value&&!creatorKind.value&&!sidebarFloatingDisabled.value,checked:sidebarFloatingDisabled.value||sidebarPresentationMode.value==='fixed',reason:sidebarFloatingDisabledReason.value||'请先返回工作区，桌面侧栏支持固定或悬浮'},'view.workspace':scoped(true,fileWorkspaceVisible.value?'隐藏工作区':'显示工作区',fileWorkspaceVisible.value),'view.workspaceExpand':scoped(fileWorkspaceVisible.value,browserExpanded.value?'恢复分栏':'展开工作区',browserExpanded.value),'view.summary':scoped(true,resourceOpen.value?'隐藏对话摘要':'显示对话摘要',resourceOpen.value),'editor.focus':scoped(true),'help.docs':true,
  }
})
const appEditCommands:Partial<Record<AppCommandId,ComposerEditorCommand>>={'edit.undo':'undo','edit.redo':'redo','edit.cut':'cut','edit.copy':'copy','edit.paste':'paste','edit.pastePlain':'paste-plain','edit.delete':'delete','edit.selectAll':'select-all','editor.link':'link','editor.unlink':'unlink','editor.attach':'attach'}
async function executeApplicationCommand(id:AppCommandId,context?:AppCommandContext){
  const edit=appEditCommands[id],target=(context?.target as ApplicationTarget|undefined)||applicationTarget.value
  try{
    if(edit){
      restoreApplicationTarget(target)
      if(target.kind==='composer'){await target.editor.executeCommand(edit);return}
      if(target.kind==='standard'){const command=edit==='paste-plain'?'pastePlain':edit==='select-all'?'selectAll':edit;if(['undo','redo','cut','copy','paste','pastePlain','delete','selectAll'].includes(command))await applicationEdit.execute(command as 'undo'|'redo'|'cut'|'copy'|'paste'|'pastePlain'|'delete'|'selectAll',target.bookmark)}
      return
    }
    if(id==='conversation.new')await createChat()
    else if(id==='browser.new'){if(docsOpen.value)await closeDocsPage();else ++docsNavigation;settingsOpen.value=false;creatorKind.value=null;activateSidebar('chats',false);await openBrowserTab()}
    else if(id==='browser.copyUrl'||id==='browser.openExternal'){if(!target.browser?.context)throw Error('页面地址不可用，请重新打开菜单。');await window.navora!.browser.workspace.pageAddressAction(target.browser.context,id==='browser.copyUrl'?'copy':'external')}
    else if(id==='browser.reload'||id==='browser.reloadIgnoringCache'||id==='browser.mute'){if(!target.browser?.pageId)throw Error('页面已变化，请重新打开菜单。');await fileWorkspace.value?.shortcut(id==='browser.reload'?'reload':id==='browser.reloadIgnoringCache'?'reloadIgnoringCache':'mute',target.browser.pageId)}
    else if(id==='browser.reopen'&&activeId.value)await window.navora?.browser.workspace.tabAction({chatId:activeId.value,action:'reopen'})
    else if(id==='conversation.openFile')applicationFilePicker.value=true
    else if(id==='conversation.openFolder'&&activeId.value){const result=await window.navora?.workspace.open(activeId.value,'.');if(!result?.ok)throw Error(result?.error||'无法打开对话文件夹')}
    else if(id==='conversation.export')await exportActiveChat()
    else if(id==='content.close'){if(docsOpen.value)await closeDocsPage();else if(activeFileTab.value)await closeFileTab(activeFileTab.value.key)}
    else if(id==='app.settings')await openSettings(undefined,{target})
    else if(id==='help.about')await openSettings('about',{target})
    else if(id==='app.quit')onMoreQuit()
    else if(id==='conversation.search')openChatSearch()
    else if(id==='conversation.find'){if(docsOpen.value)docsWorkspace.value?.runAction('focusSearch');else openConversationFind()}
    else if(id==='view.sidebar')await toggleSidebarVisibility()
    else if(id==='view.sidebarPinned'){if(!settingsOpen.value&&!creatorKind.value)toggleSidebarPin()}
    else if(id==='view.workspace')toggleRightSidebar()
    else if(id==='view.workspaceExpand')toggleBrowserExpand()
    else if(id==='view.fullscreen')await window.navora?.app.toggleFullscreen()
    else if(id==='view.summary')toggleResources()
    else if(id==='editor.focus'){if(docsOpen.value)await closeDocsPage();else ++docsNavigation;settingsOpen.value=false;creatorKind.value=null;activateSidebar('chats',false);focusComposer()}
    else if(id==='help.docs')await onMoreDocs()
  }catch(error){showToast(id==='browser.copyUrl'||id==='browser.openExternal'?browserPageAddressError(error):error instanceof Error?error.message:'操作未完成，请重试。','warning')}
}

async function useSuggestion(s: string | FollowupSuggestion) {
  const chatId = activeId.value
  if (!chatId) return

  if (typeof s === 'string') {
    applyDraftLocally(clampDraftText(s), Date.now())
    scheduleDraftSave()
    focusComposer()
    return
  }

  if (s.action.type === 'store_install') {
    try {
      await openInstallerById(s.action.kind, s.action.productId, 'install')
      clearFollowups(chatId)
    } catch (e) {
      showToast(storeErrorText(e instanceof Error ? e.message : '打开安装失败'))
    }
    return
  }

  if (s.action.type === 'file_reveal' || s.action.type === 'file_open') {
    try {
      const api = window.navora?.workspace
      if (!api?.[s.action.type === 'file_reveal' ? 'reveal' : 'open']) {
        showToast('当前环境不支持打开工作区文件')
        return
      }
      const res =
        s.action.type === 'file_reveal'
          ? await api.reveal(chatId, s.action.path)
          : await api.open(chatId, s.action.path)
      if (!res?.ok) {
        showToast(res?.error || '打开失败')
        return
      }
      showToast(
        s.action.type === 'file_reveal' ? '已在资源管理器中显示' : '已用默认程序打开',
        'primary',
      )
      clearFollowups(chatId)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '打开失败')
    }
    return
  }

  const text = s.action.type === 'prompt' ? s.action.text : s.label
  applyDraftLocally(clampDraftText(text), Date.now())
  scheduleDraftSave()
  focusComposer()
}

function onMessagesClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  const a = target?.closest?.('a') as HTMLAnchorElement | null
  if (!a?.href) return
  const href = a.getAttribute('href') || a.href
  if (!/^https?:/i.test(href) && !/^mailto:/i.test(href)) return
  e.preventDefault()
  e.stopPropagation()
  if(/^https?:/i.test(href))void appLinks.openLink(href,activeId.value||undefined)
  else void window.navora?.app.openExternal(href)
}

function refKey(r: BrowserContextRef) {
  return r.kind==='annotation'?`a:${r.annotationId}:${r.annotationRevision}`:r.kind === 'window' ? `w:${r.windowId}` : `s:${r.sessionId}`
}
function chipLabel(reference:BrowserContextRef){return reference.label||(reference.kind==='session'?'浏览器会话':reference.kind==='annotation'?'网页标注':'网页')}

async function addRef(reference:BrowserContextRef){
  if(contextRefs.value.some(saved=>refKey(saved)===refKey(reference))){focusComposer();return}
  const chatId=activeId.value;if(!chatId)return
  settingsOpen.value=false;creatorKind.value=null;activateSidebar('chats',false)
  await nextTick();if(activeId.value!==chatId)return
  const node=composerDocumentFromLegacy(chatId,'',[JSON.parse(JSON.stringify(reference))]).content.find(node=>node.type==='contextBlock')
  const block=node?.attrs?.block as ComposerContextBlock|undefined
  if(block)draftField.value?.insertContext(block)
}

function onDragEnter(e: DragEvent) {
  if (![...((e.dataTransfer?.types as string[]) || [])].includes(DND_MIME)) return
  dragDepth += 1
  dropActive.value = true
}

function onDragOver(e: DragEvent) {
  if (![...((e.dataTransfer?.types as string[]) || [])].includes(DND_MIME)) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dropActive.value = true
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropActive.value = false
}

function onDrop(e: DragEvent) {
  dragDepth = 0
  dropActive.value = false
  const raw = e.dataTransfer?.getData(DND_MIME)
  if (!raw) return
  try {
    addRef(JSON.parse(raw) as BrowserContextRef)
  } catch {
    /* ignore */
  }
}

function hydratePersistedAsks(list: ChatSession[]) {
  for (const c of list) {
    if (c.pendingAsk && c.pendingAsk.timeoutMs <= 0 && c.pendingAsk.kind === 'user_choice') {
      rememberPendingAsk(c.pendingAsk)
    }
  }
}

async function refreshList() {
  if (!window.navora) return
  chats.value = await window.navora.chats.list()
  hydratePersistedAsks(chats.value)
  windowCounts.value = await window.navora.browser.windowCounts()
  if (!activeId.value && chats.value.length) {
    const firstMain = chats.value.find((c) => c.kind !== 'sub') || chats.value[0]
    await selectChat(firstMain.id,{preserveDocs:true})
  }
}

let chatSelection = 0
let chatTransition: Animation | undefined
async function selectChat(id: string,options?:{preserveDocs?:boolean}) {
  if(!options?.preserveDocs){if(docsOpen.value)await closeDocsPage();else ++docsNavigation}
  const selection = ++chatSelection
  const linked=chats.value.find(chat=>chat.id===id)||(window.navora?await window.navora.chats.get(id):null)
  if(selection!==chatSelection)return
  if(!linked)return
  if(linked?.kind==='sub'&&linked.parentChatId){await routeConversationTarget(id);return}
  if(!await canLeaveSettings()||!await flushQuestionnaireDraft())return
  creatorKind.value = null
  if (!window.navora) return
  settingsOpen.value = false
  const prev = activeId.value
  if (prev && prev !== id) {
    await flushDraftSave(prev).catch(()=>showToast('未同步的草稿已保留在当前窗口，返回该对话后可继续处理。','warning'))
  }
  if (selection !== chatSelection) return
  if (prev && prev !== id) revokeMediaUrlsForChat(prev)
  toolMediaSrc.value = {}
  closeLightbox()
  closeReadPagesPanel()
  activeId.value = id
  if(options?.preserveDocs&&docsSnapshot&&!docsSnapshot.chatId)docsSnapshot.chatId=id
  const [nextChat, nextTree, running] = await Promise.all([
    window.navora.chats.get(id), window.navora.browser.tree(id), window.navora.agent.isRunning(id),
  ])
  if (selection !== chatSelection) return
  active.value = nextChat
  tree.value = nextTree
  syncBrowserTabs(nextTree)
  if (
    active.value?.pendingAsk &&
    active.value.pendingAsk.timeoutMs <= 0 &&
    active.value.pendingAsk.kind === 'user_choice'
  ) {
    rememberPendingAsk(active.value.pendingAsk)
  }
  setRunning(id, running)
  // Restore retry affordance from persisted agent_error / agent_stop logs.
  if (!running) {
    const failed = lastUserTurnFailed(active.value?.messages)
    if (failed.failed) {
      rememberChatError(
        id,
        failed.reason === 'stop'
          ? `user_stopped:${failed.summary || '用户终止'}`
          : failed.summary || 'Agent 出错',
      )
    }
  }
  if (running) {
    const saved = phaseByChat.value[id]
    if (saved && saved.phase !== 'idle') {
      phase.value = saved.phase
      phaseDetail.value = saved.detail || 'Agent 运行中…'
    } else {
      phase.value = 'thinking'
      phaseDetail.value = 'Agent 运行中…'
    }
  } else {
    phase.value = 'idle'
    phaseDetail.value = ''
  }
  draftState.load(active.value)
  resumeMessageFollow()
  void hydrateActiveToolMedia()
  showJumpBottom.value = false
  followupSuggestions.value = followupsByChat.value[id] || []
  await scrollMessages(true)
  if (selection !== chatSelection) return
  chatTransition?.cancel()
  if (prev !== id && msgBox.value && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const transition=msgBox.value.animate([{ opacity: .35, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' })
    chatTransition=transition
    // The transition can defer painting skipped transcript rows beyond the
    // initial native end scroll. Follow once after that layout actually paints.
    void transition.finished.then(()=>{
      if(selection===chatSelection&&activeId.value===id&&chatTransition===transition&&stickToBottom.value&&!messageReadingIntent)void scrollMessages()
    }).catch(()=>{})
  }
  focusComposer()
  closeMobileSidebar()
}

let creatingChat: Promise<void> | undefined
async function createChat() {
  if(docsOpen.value)await closeDocsPage();else ++docsNavigation
  if(!await canLeaveSettings()||!await flushQuestionnaireDraft())return
  activateSidebar('chats',false)
  creatorKind.value = null
  if (!window.navora) return
  if (creatingChat) return creatingChat
  // Repeated clicks and shortcuts on an untouched conversation only focus it.
  // Keep drafts, references and the selected model intact.
  if (active.value && !active.value.messages.length && !agentRunning.value) {
    settingsOpen.value = false
    closeMobileSidebar()
    focusComposer()
    return
  }
  creatingChat = (async () => {
    try {
      const c = await window.navora!.chats.create()
      await refreshList()
      await selectChat(c.id)
    } catch (e) {
      console.error(e)
      showToast(e instanceof Error ? e.message : '创建 Chat 失败')
    }
  })()
  try { await creatingChat } finally { creatingChat = undefined }
}

function askDeleteChat(c: ChatSession) {
  closeChatSwipe()
  chatMoreOpenId.value = null
  deleteBatchIds.value = null
  deleteTarget.value = c
  deleteDialog.value = true
}

function showNativeChatRowMenu(chat:ChatSession,event:MouseEvent|KeyboardEvent){void openChatRowContext(event,chat)}

function setRenameInputRef(chatId: string, el: unknown) {
  if (el instanceof HTMLInputElement) {
    renameInputEls.set(chatId, el)
    if (renamingChatId.value === chatId) {
      renameIgnoreBlurUntil = Math.max(renameIgnoreBlurUntil, Date.now() + 280)
      requestAnimationFrame(() => selectRenameInputAll(el))
    }
  } else {
    renameInputEls.delete(chatId)
  }
}

function selectRenameInputAll(input: HTMLInputElement) {
  try {
    input.focus({ preventScroll: true })
    const len = input.value.length
    input.setSelectionRange(0, len)
    input.select()
  } catch {
    /* ignore */
  }
}

function onRenameInputFocus(ev: FocusEvent) {
  const input = ev.target
  if (!(input instanceof HTMLInputElement)) return
  // Defer so browser finishes focus before select (esp. after closing v-menu).
  requestAnimationFrame(() => selectRenameInputAll(input))
}

function onRenameInputBlur() {
  if (Date.now() < renameIgnoreBlurUntil) {
    const chatId = renamingChatId.value
    const input = chatId ? renameInputEls.get(chatId) : null
    if (input) {
      requestAnimationFrame(() => selectRenameInputAll(input))
      return
    }
  }
  void commitRenameChat()
}

function renameCurrentChat() {
  if(!active.value)return
  activateSidebar('chats',false)
  if(isMobileLayout.value)mobileSidebarOpen.value=true
  if(chatBatchMode.value)exitChatBatchMode()
  startRenameChat(active.value)
}

function startRenameChat(c: ChatSession) {
  closeChatSwipe()
  chatMoreOpenId.value = null
  renamingChatId.value = c.id
  renameDraft.value = displayChatTitle(c.title)
  renameIgnoreBlurUntil = Date.now() + 280
  const focusAndSelect = () => {
    const input = renameInputEls.get(c.id)
    if (!input) return false
    selectRenameInputAll(input)
    return true
  }
  void nextTick(() => {
    if (focusAndSelect()) return
    // Input may mount one frame later after menu teardown.
    requestAnimationFrame(() => {
      if (focusAndSelect()) return
      window.setTimeout(() => {
        focusAndSelect()
      }, 40)
    })
  })
}

function cancelRenameChat() {
  renamingChatId.value = null
  renameDraft.value = ''
}

async function commitRenameChat() {
  if (renameCommitLock) return
  const chatId = renamingChatId.value
  if (!chatId) return
  const next = renameDraft.value.trim().replace(/\s+/g, ' ')
  // Empty title = keep current, just exit edit mode.
  if (!next) {
    cancelRenameChat()
    return
  }
  const current = chats.value.find((c) => c.id === chatId)
  const prev = displayChatTitle(current?.title)
  if (next === prev) {
    cancelRenameChat()
    return
  }
  if (!window.navora?.chats.setTitle) {
    cancelRenameChat()
    showToast('当前环境不支持修改标题')
    return
  }
  renameCommitLock = true
  try {
    const chat = await window.navora.chats.setTitle(chatId, next)
    if (chat) {
      const idx = chats.value.findIndex((c) => c.id === chatId)
      if (idx >= 0) chats.value[idx] = { ...chats.value[idx], ...chat }
      if (activeId.value === chatId && active.value) {
        active.value = { ...active.value, title: chat.title, titleGenerated: true }
      }
    }
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : '修改标题失败')
  } finally {
    renameCommitLock = false
    cancelRenameChat()
  }
}

async function toggleChatPinned(c: ChatSession) {
  if (!window.navora) return
  chatMoreOpenId.value = null
  const next = !c.pinned
  try {
    await window.navora.chats.setPinned(c.id, next)
    await refreshList()
    if (activeId.value) {
      active.value = (await window.navora.chats.get(activeId.value)) || active.value
    }
    showToast(next ? '已置顶' : '已取消置顶', 'primary')
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : '置顶失败')
  }
}

function cancelDeleteChat() {
  if (deleting.value) return
  deleteDialog.value = false
  deleteTarget.value = null
  deleteBatchIds.value = null
}

function cleanupAfterChatDeleted(id: string) {
  removeFileOwner(id)
  if (activeId.value === id) {
    activeId.value = null
    active.value = null
    tree.value = []
    agentRunning.value = false
  }
  clearPendingAsk(id)
  clearChatError(id)
  if (askReq.value?.chatId === id) closeAskUi()
  const next = { ...runningChats.value }
  delete next[id]
  runningChats.value = next
}

async function confirmDeleteChat() {
  if (!window.navora) return
  const wasBatch = Boolean(deleteBatchIds.value?.length)
  const ids = wasBatch
    ? [...deleteBatchIds.value!]
    : deleteTarget.value
      ? [deleteTarget.value.id]
      : []
  if (!ids.length) return
  deleting.value = true
  try {
    for (const id of ids) {
      await window.navora.chats.delete(id)
      cleanupAfterChatDeleted(id)
    }
    deleteDialog.value = false
    deleteTarget.value = null
    deleteBatchIds.value = null
    await refreshList()
    if (!chats.value.length) {
      await createChat()
    } else if (!activeId.value) {
      await selectChat(chats.value[0].id)
    }
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : '删除 Chat 失败')
  } finally {
    deleting.value = false
    if (wasBatch) exitChatBatchMode()
  }
}

function askCloseSession(s: BrowserTreeSession) {
  closeSessionTarget.value = s
  closeSessionDialog.value = true
}

function cancelCloseSession() {
  if (closingSession.value) return
  closeSessionDialog.value = false
  closeSessionTarget.value = null
}

async function confirmCloseSession() {
  if (!window.navora || !closeSessionTarget.value) return
  closingSession.value = true
  const sessionId = closeSessionTarget.value.sessionId
  try {
    await window.navora.browser.closeSession(sessionId)
    markBrowserSources(new Set(tree.value.flatMap(session=>session.windows.map(page=>page.windowId))),new Set(tree.value.filter(session=>session.sessionId!==sessionId).map(session=>session.sessionId)))
    if (activeId.value) {
      tree.value = await window.navora.browser.tree(activeId.value)
      syncBrowserTabs(tree.value)
      windowCounts.value = await window.navora.browser.windowCounts()
    }
    closeSessionDialog.value = false
    closeSessionTarget.value = null
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : '关闭 Session 失败')
  } finally {
    closingSession.value = false
  }
}

async function confirmQuit() {
  if (!window.navora?.app.quit || quitting.value || !quitReady.value) return
  const acknowledgedRunningAgents=quitRunningAgents.value!
  quitting.value = true
  let draftsSaved=false
  try {
    if(!await flushQuestionnaireDraft()){showToast('问卷草稿尚未保存，请处理保存提示后重试。','warning');quitting.value=false;return}
    await flushDraftSave()
    draftsSaved=true
    if(!await quitConfirmation.refresh()){quitting.value=false;return}
    if(quitRunningAgents.value!>acknowledgedRunningAgents){showToast('运行中的任务已变化，请再次确认退出。','warning');quitting.value=false;return}
    const result=await window.navora.app.quit(acknowledgedRunningAgents)
    if(result?.ok===false&&result.reason==='running_agents_changed'){
      await quitConfirmation.refresh();showToast('运行中的任务已变化，请再次确认退出。','warning');quitting.value=false;return
    }
    if(result?.ok===false)throw Error('退出未完成，请重试。')
  } catch (e) {
    console.error(e)
    quitting.value = false
    showToast(draftsSaved?(e instanceof Error?e.message:'退出失败'):'草稿尚未保存，内容仍保留在编辑器中，请处理保存提示后重试。','warning')
  }
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function closeMobileSidebar() {
  mobileSidebarOpen.value = false
  closeChatSwipe()
}

function openMobileSidebar() {
  mobileSidebarOpen.value = true
}

function openRemoteWindows() {
  closeMobileSidebar()
  void router.push('/remote')
}

let docsSnapshot:{chatId:string|null;focus:HTMLElement|null;scrolls:{element:HTMLElement;top:number;left:number}[]}|undefined
let docsNavigation=0
function storedGuideChapter(){try{return readGuideReading(localStorage.getItem(GUIDE_READING_STORAGE_KEY)).chapter}catch{return 'start'}}
function guideQuery(chapter:string,section?:string){const query={...route.query};query.docs=chapter;delete query.section;if(section)query.section=section;return query}
async function onMoreDocs(chapter?:string,section?:string,fromRoute=false){
  const request=++docsNavigation,target=resolveGuideTarget(chapter||docsChapter.value||storedGuideChapter(),section),routeIntent=fromRoute?route.fullPath:undefined
  const current=()=>request===docsNavigation&&(!fromRoute||route.fullPath===routeIntent)
  if(!await canLeaveSettings()||!await flushQuestionnaireDraft()||!current())return
  try{await flushDraftSave()}catch{showToast('草稿尚未保存，请处理保存提示后再打开使用文档。','warning');return}
  if(!current())return
  if(!docsOpen.value)docsSnapshot={chatId:activeId.value,focus:document.activeElement instanceof HTMLElement?document.activeElement:null,scrolls:[...document.querySelectorAll<HTMLElement>('.messages,.preview-content,.file-manager-scroll,.plugin-detail-scroll')].filter(element=>element.checkVisibility()).map(element=>({element,top:element.scrollTop,left:element.scrollLeft}))}
  modeMenuOpen.value=false;permMenuOpen.value=false;modelMenuOpen.value=false;usageMenuOpen.value=false;attachmentMenu.value?.hide(false);windowFind.close();chatSearchOpen.value=false
  docsChapter.value=target.chapter;docsSection.value=target.section||'';docsOpen.value=true;closeMobileSidebar();await nextTick()
  if(!current()||!docsOpen.value)return
  docsWorkspace.value?.runAction('focusSearch')
  if(route.query.docs!==target.chapter||(route.query.section||'')!==(target.section||''))await router.replace({path:'/',query:guideQuery(target.chapter,target.section)})
}
async function navigateDocs(value:{chapter:string;section?:string}){
  if(!docsOpen.value)return
  ++docsNavigation;const target=resolveGuideTarget(value.chapter,value.section)
  docsChapter.value=target.chapter;docsSection.value=target.section||''
  await router.replace({path:'/',query:guideQuery(target.chapter,target.section)})
}
async function closeDocsPage(updateRoute=true){
  const request=++docsNavigation,saved=docsSnapshot;docsSnapshot=undefined;docsOpen.value=false
  if(updateRoute){const query={...route.query};delete query.docs;delete query.section;await router.replace({path:'/',query})}
  await nextTick()
  if(request!==docsNavigation||docsOpen.value)return
  if(saved?.chatId===activeId.value){for(const scroll of saved.scrolls)if(scroll.element.isConnected){scroll.element.scrollTop=scroll.top;scroll.element.scrollLeft=scroll.left}if(saved.focus?.isConnected&&saved.focus.checkVisibility())saved.focus.focus({preventScroll:true})}
}
watch(()=>[route.query.docs,route.query.section],([chapter,section],previous)=>{
  if(typeof chapter==='string'){if(!docsOpen.value||docsChapter.value!==chapter||docsSection.value!==(section||''))void onMoreDocs(chapter,typeof section==='string'?section:undefined,true)}
  else if(docsOpen.value&&typeof previous?.[0]==='string')void closeDocsPage(false)
},{immediate:true})

function onMoreQuit() {
  if(quitDialog.value)void quitConfirmation.refresh()
  else quitDialog.value = true
}

async function exportActiveChat() {
  await exportChatById(activeId.value || undefined)
}

async function exportChatById(chatId?: string) {
  const id = String(chatId || '').trim()
  if (!window.navora || !id || exportingChat.value) return
  exportingChat.value = true
  try {
    const chat =
      (await window.navora.chats.get(id)) ||
      chats.value.find((c) => c.id === id) ||
      (active.value?.id === id ? active.value : null)
    if (!chat) {
      showToast('未找到当前对话')
      return
    }
    if (!chat.messages?.length) {
      showToast('当前对话为空，无可导出内容')
      return
    }

    if (isWebRemote()) {
      const filename = suggestChatExportFilename(chat, 'md')
      downloadTextFile(filename, formatChatExportContent(chat, 'md'), 'text/markdown;charset=utf-8')
      showToast('已开始下载导出文件', 'success')
      return
    }

    const res = await window.navora.chats.export(chat.id)
    if (res.canceled) return
    if (!res.ok) {
      const errMap: Record<string, string> = {
        empty_chat: '当前对话为空，无可导出内容',
        chat_not_found: '未找到当前对话',
        remote_unsupported: '远程端请使用浏览器下载',
      }
      showToast(errMap[res.error || ''] || res.error || '导出失败')
      return
    }
    showToast(res.path ? `已导出到 ${res.path}` : '对话已导出', 'success')
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : '导出失败')
  } finally {
    exportingChat.value = false
  }
}

type ChatSearchHit = {
  id: string
  title: string
  updatedAt: number
  snippet: string
}

function normalizeSearchText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function messageSearchSnippet(c: ChatSession, q: string): string {
  const needle = normalizeSearchText(q)
  if (!needle) return ''
  for (const m of c.messages || []) {
    const content = String(m.content || '')
    const idx = normalizeSearchText(content).indexOf(needle)
    if (idx < 0) continue
    const rawIdx = content.toLowerCase().indexOf(q.trim().toLowerCase())
    const start = Math.max(0, (rawIdx >= 0 ? rawIdx : 0) - 24)
    const slice = content.slice(start, start + 96).replace(/\s+/g, ' ').trim()
    return (start > 0 ? '…' : '') + slice + (start + 96 < content.length ? '…' : '')
  }
  return ''
}

const chatSearchHits = computed((): ChatSearchHit[] => {
  const q = chatSearchQuery.value.trim()
  if (!q) return chats.value.slice(0, 30).map(c => ({ id: c.id, title: displayChatTitle(c.title), updatedAt: c.updatedAt, snippet: '' }))
  const needle = normalizeSearchText(q)
  const hits: ChatSearchHit[] = []
  for (const c of chats.value) {
    const title = String(c.title || '')
    const titleHit = normalizeSearchText(title).includes(needle)
    const snippet = messageSearchSnippet(c, q)
    if (!titleHit && !snippet) continue
    hits.push({
      id: c.id,
      title: displayChatTitle(title),
      updatedAt: c.updatedAt,
      snippet: titleHit && !snippet ? '' : snippet,
    })
  }
  return hits.slice(0, 50)
})
const chatSearchNative=computed(()=>chatSearchPanel(chatSearchHits.value.map(hit=>({...hit,relative:formatRelative(hit.updatedAt)})),chatSearchQuery.value,activeId.value))
const chatSearchNativeInitial=computed(()=>chatSearchPanel(chatSearchHits.value.map(hit=>({...hit,relative:formatRelative(hit.updatedAt)})),chatSearchQuery.value,activeId.value,true).content)
function chatSearchAction(action:NativePanelAction){
  if(!chatSearchOpen.value)return
  if(action.id==='chat-search-query'&&typeof action.value==='string'){chatSearchQuery.value=action.value;if(action.type==='submit')void pickFirstSearchHit()}
  else if(action.type==='click'){if(action.id==='chat-search-close')closeChatSearch();else{const id=chatSearchNative.value.actions.get(action.id);if(id&&chatSearchHits.value.some(hit=>hit.id===id)&&chats.value.some(chat=>chat.id===id))void pickSearchChat(id)}}
}

function openChatSearch() {
  windowFind.close()
  if(!chatSearchOpen.value)chatSearchQuery.value = ''
  chatSearchFocusRequest.value++
  chatSearchOpen.value = true
  void nextTick(() => chatSearchInput.value?.focus())
}

function closeChatSearch() {
  chatSearchOpen.value = false
  chatSearchQuery.value = ''
}

async function pickSearchChat(id: string) {
  closeChatSearch()
  await selectChat(id)
}

async function pickFirstSearchHit() {
  const first = chatSearchHits.value[0]
  if (!first) return
  await pickSearchChat(first.id)
}

function onPanelNotify(text: string, color = 'error') {
  showToast(text, color)
}

type PageCtx =
  | { kind: 'chat'|'sub'; chat: ChatSession;runId?:string;running:boolean }
  | {
      kind: 'msg'
      chatId:string
      selected: string
      messageText: string
      messageId?: string
      hasChat: boolean
    }

const pageCtx = ref<PageCtx | null>(null)
const pageCtxMenu = ref<{ show: (e: MouseEvent|KeyboardEvent) => void;hide:()=>void;open:boolean } | null>(null)
watch(()=>pageCtxMenu.value?.open,open=>{if(!open)chatMoreOpenId.value=null})

function chatContextKeyboard(event:KeyboardEvent){return !event.isComposing&&(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')}
async function openChatRowContext(event:MouseEvent|KeyboardEvent,chat:ChatSession){
  if(chatBatchMode.value||(event.target as HTMLElement|null)?.closest?.('input,textarea,[contenteditable]'))return
  event.preventDefault();event.stopPropagation()
  const epoch=++nativeRowMenuEpoch,id=chat.id,anchor=event.currentTarget as HTMLElement|null
  try{
    const [current,running]=await Promise.all([window.navora?.chats.get(id),window.navora?.agent.isRunning(id)])
    if(epoch!==nativeRowMenuEpoch||!anchor?.isConnected)return
    if(!current||!chats.value.some(item=>item.id===id)){showToast('对话已变化，请重新打开菜单。','warning');return}
    const runId=current.kind==='sub'&&current.subchatRun?.status==='running'?current.subchatRun.id:[...current.messages].reverse().find(message=>typeof message.meta?.runId==='string')?.meta?.runId
    pageCtx.value={kind:current.kind==='sub'?'sub':'chat',chat:current,runId,running:!!running}
    chatMoreOpenId.value=id
    await nextTick();pageCtxMenu.value?.show(event)
  }catch{if(epoch===nativeRowMenuEpoch)showToast('菜单暂时无法打开，请重试。','warning')}
}
function onChatItemContextKey(event:KeyboardEvent,chat:ChatSession){if(chatContextKeyboard(event))void openChatRowContext(event,chat)}
async function runChatContextAction(action:'find'|'folder'|'stop'|'rename'|'pin'|'export'|'delete'){
  const target=pageCtx.value;if(!target||target.kind==='msg'||!window.navora)return
  const id=target.chat.id,current=chats.value.find(chat=>chat.id===id)
  if(!current){showToast('对话已变化，请重新打开菜单。','warning');return}
  try{
    if(action==='find'){
      await routeConversationTarget(id);await nextTick()
      if(current.kind==='sub'){if(activeFileTab.value?.kind==='subchats'&&activeFileTab.value.selectedSubchatId===id&&!openWindowFind('workspace'))showToast('此对话暂时无法查找，请重试。','warning')}
      else if(activeId.value===id){revealFindConversation();await nextTick();await openConversationFind()}
      return
    }
    if(action==='folder'){
      if(isWebRemote())return
      const result=await window.navora.workspace.open(id,'.');if(!result.ok)throw Error(result.error||'无法打开对话文件夹')
    }else if(action==='stop'){
      if(!target.running||!target.runId)return
      const result=await window.navora.agent.stop(id,target.runId)
      if(result.error==='agent_run_changed')showToast('任务已变化，请重新打开菜单。','warning')
      else if(!result.ok)showToast('当前任务已结束。','warning')
    }else if(action==='rename')startRenameChat(current)
    else if(action==='pin')await toggleChatPinned(current)
    else if(action==='export')await exportChatById(id)
    else if(action==='delete')askDeleteChat(current)
  }catch(error){showToast(error instanceof Error?error.message:'操作未完成，请重试。','warning')}
}

function messageTaskDeclarationLabel(message:ChatMessage){return taskDeclarationsLabel(message.meta?.taskConstraints?.declarations??message.meta?.document?.declarations)}
function messagePlainText(m: ChatMessage): string {
  if (m.role === 'log') return logFullText(m)
  if (m.role === 'tool') {
    const name =
      typeof m.meta?.toolName === 'string' && m.meta.toolName ? m.meta.toolName : 'tool'
    const title = toolHeadTitle(m)
    const head = title ? `[${name}] ${title}` : `[${name}]`
    const body = String(m.content || '').trim()
    return body ? `${head}\n${body}` : head
  }
  if (m.role === 'assistant') return displayMessageContent(m).trim()
  const label=messageTaskDeclarationLabel(m)
  return [label?'任务声明：'+label:'',String(m.content||'').trim()].filter(Boolean).join('\n\n')
}

function resolveMsgContext(e: MouseEvent|KeyboardEvent): { messageText: string; messageId?: string } {
  const target = e.target as HTMLElement | null
  if (!target?.closest) return { messageText: '' }

  const msgEl = target.closest('[data-msg-id]') as HTMLElement | null
  if (msgEl) {
    const id = msgEl.getAttribute('data-msg-id') || ''
    const m = active.value?.messages?.find((x) => x.id === id)
    if (m) return { messageText: messagePlainText(m), messageId: id }
  }

  const runEl = target.closest('[data-run-key]') as HTMLElement | null
  if (runEl) {
    const key = runEl.getAttribute('data-run-key') || ''
    const block = messageBlocks.value.find((b) => b.type === 'run' && b.key === key)
    if (block && block.type === 'run') {
      const text = block.items
        .map((item) => messagePlainText(item))
        .filter(Boolean)
        .join('\n\n')
      return { messageText: text, messageId: block.items[0]?.id }
    }
  }

  return { messageText: '' }
}

function onChatItemContext(e: MouseEvent, c: ChatSession) {void openChatRowContext(e,c)}
function onMessageContextKey(event:KeyboardEvent){if(chatContextKeyboard(event))onMessagesContext(event)}

function onMessagesContext(e: MouseEvent|KeyboardEvent) {
  // Inputs inside the message list (rare) are handled globally.
  if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable]')) return
  const selection=window.getSelection?.(),root=msgBox.value
  const selected = selection?.anchorNode&&selection.focusNode&&root?.contains(selection.anchorNode)&&root.contains(selection.focusNode)?String(selection.toString()).trim():''
  const { messageText, messageId } = resolveMsgContext(e)
  const hasChat = !!(active.value?.messages?.length)
  if (!selected && !messageText && !hasChat) return
  pageCtx.value = {
    kind: 'msg',
    chatId:activeId.value||'',
    selected,
    messageText,
    messageId,
    hasChat,
  }
  pageCtxMenu.value?.show(e)
}

async function runMessageContextAction(action:'copy-selection'|'quote-selection'|'copy-message'|'quote-message'|'copy-chat'|'export'){
  const target=pageCtx.value;if(target?.kind!=='msg'||!target.chatId)return
  if(action==='copy-selection'){await copyText(target.selected);return}
  if(action==='copy-message'){await copyText(target.messageText);return}
  if(action==='export'){await exportChatById(target.chatId);return}
  if(action==='copy-chat'){
    const chat=await window.navora?.chats.get(target.chatId)
    if(chat?.messages.length)await copyText(formatChatExportContent(chat,'md'))
    return
  }
  if(activeId.value!==target.chatId){await selectChat(target.chatId);await nextTick()}
  if(activeId.value===target.chatId){revealFindConversation();await nextTick();quoteToComposer(action==='quote-selection'?target.selected:target.messageText)}
}

const copiedMessageId = ref<string | null>(null)
let copiedMessageTimer: ReturnType<typeof setTimeout> | undefined
async function copyReply(message: ChatMessage) {
  try {
    await navigator.clipboard.writeText(displayMessageContent(message))
    copiedMessageId.value = message.id
    clearTimeout(copiedMessageTimer)
    copiedMessageTimer = setTimeout(() => { copiedMessageId.value = null }, 1600)
  } catch { showToast('复制失败，请重试') }
}

let messageJump = 0
let jumpFocusAnimation: Animation | null = null
let messageJumpJob:{cancelled:boolean;detach:()=>void}|undefined
let nearestMessageContainer:boolean|undefined
function cancelMessageJump(){
  messageJump++
  if(messageJumpJob){messageJumpJob.cancelled=true;messageJumpJob.detach();messageJumpJob=undefined}
  messageJumpInProgress=false
}
function positionMessageInScroller(element:HTMLElement,box:HTMLElement,block:ScrollLogicalPosition='start'){
  const options={block,inline:'nearest',behavior:'instant'} as ScrollIntoViewOptions
  if(nearestMessageContainer===undefined){
    let recognized=false
    document.createElement('span').scrollIntoView({...options,get container(){recognized=true;return 'nearest'}} as ScrollIntoViewOptions)
    nearestMessageContainer=recognized
  }
  if(nearestMessageContainer){
    element.scrollIntoView({...options,container:'nearest'} as ScrollIntoViewOptions)
  }else{
    // Older remote browsers ignore the container option. Preserve every outer
    // scroller while letting native layout materialize the destination.
    const outer:Array<{element:HTMLElement;top:number;left:number}>=[]
    for(let parent=box.parentElement;parent;parent=parent.parentElement)outer.push({element:parent,top:parent.scrollTop,left:parent.scrollLeft})
    element.scrollIntoView(options)
    for(const saved of outer){saved.element.scrollTop=saved.top;saved.element.scrollLeft=saved.left}
  }
}
watch(activeId,()=>{cancelMessageJump();messageReadingIntent=false;userMessageScroll=false;userMessageScrollPending=false},{flush:'sync'})
onUnmounted(cancelMessageJump)
async function locateResourceMessage(payload:{chatId:string;messageId:string}){
  activateSidebar('chats',false)
  const owner=chats.value.find(chat=>chat.id===payload.chatId)||await window.navora?.chats.get(payload.chatId)
  if(owner?.kind==='sub'){
    await routeConversationTarget(payload.chatId)
    if(resourceOverlay.value)closeResources()
    await nextTick()
    if(activeFileTab.value?.kind==='subchats'&&activeFileTab.value.selectedSubchatId===payload.chatId)await fileWorkspace.value?.locateSubchatMessage(payload.messageId)
    return
  }
  if(activeId.value!==payload.chatId)await selectChat(payload.chatId)
  if(activeId.value!==payload.chatId)return
  if(resourceOverlay.value)closeResources()
  if(fileWorkspaceOverlay.value)hideFileWorkspace()
  else if(browserExpanded.value&&fileWorkspaceVisible.value)workspaceConversationActive.value=true
  await nextTick()
  await jumpToMessage(payload.messageId)
}
async function jumpToMessage(id: string) {
  await revealMessageProcess(id)
  cancelMessageJump()
  const request = ++messageJump
  const version=++conversationScrollVersion,chatId=activeId.value
  // Explicit navigation wins over a queued restoration of a hidden chat.
  parkedConversation=undefined;restoringConversation=false;messageJumpInProgress=true
  messageReadingIntent=true;userMessageScroll=false;userMessageScrollPending=false
  stickToBottom.value = false
  jumpFocusAnimation?.cancel()
  const job={cancelled:false,detach:()=>{}}
  messageJumpJob=job
  const current=()=>!job.cancelled&&request===messageJump&&version===conversationScrollVersion&&chatId===activeId.value&&conversationIsVisible.value
  try{
    if(!current())return
    const box=msgBox.value,element=box?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`)
    if(!box?.checkVisibility()||!element)return
    const interrupt=(event:Event)=>{
      if(event instanceof KeyboardEvent&&!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))return
      if(messageJumpJob===job)cancelMessageJump()
    }
    for(const type of ['wheel','touchstart','pointerdown','keydown'])box.addEventListener(type,interrupt,{capture:true,passive:true})
    job.detach=()=>{for(const type of ['wheel','touchstart','pointerdown','keydown'])box.removeEventListener(type,interrupt,true)}
    // A transform transition can make skipped rows change their layout after an
    // otherwise stable jump. Keep cancellation live while awaiting its paint.
    const transition=chatTransition
    if(transition?.playState==='running'){
      await transition.finished.catch(()=>{})
      if(!current()||!element.isConnected)return
    }
    // Native scrollIntoView resolves content-visibility and preserves its own
    // anchor while upstream skipped rows get painted. Manual scrollTop chasing
    // can oscillate between their estimated and real heights indefinitely.
    positionMessageInScroller(element,box)
    let settledFrames=0
    let stableFrames=0,corrections=0
    let previousGeometry=''
    // Observe a bounded set of painted frames without repeatedly moving the
    // reader. Explicit navigation or physical scrolling cancels immediately.
    for(let attempt=0;attempt<24;attempt++){
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
      if(!current()||!element.isConnected)return
      const bounds=element.getBoundingClientRect(),top=bounds.top-box.getBoundingClientRect().top,tail=box.scrollHeight-box.clientHeight-box.scrollTop
      const geometry=`${box.scrollHeight}:${box.clientHeight}:${Math.round(bounds.height*10)}:${Math.round(top)}`
      const aligned=bounds.height>0&&(Math.abs(top)<1||(tail<1&&top>=0&&top+bounds.height<=box.clientHeight))
      stableFrames=geometry===previousGeometry?stableFrames+1:0
      settledFrames=aligned?stableFrames:0
      previousGeometry=geometry
      // Materializing a tail destination can shrink the remaining skipped rows
      // and clamp the first correction. Allow two native corrections, each with
      // its own painted-frame budget; never chase scrollTop or materialize all rows.
      if(!aligned&&bounds.height>0&&stableFrames>=2&&corrections<2&&attempt<20){
        corrections++;stableFrames=0;previousGeometry='';positionMessageInScroller(element,box);continue
      }
      if(attempt>=2&&settledFrames>=2)break
    }
    if(current()){
      if(chatId)conversationReading={chatId,top:box.scrollTop,follow:false}
      showJumpBottom.value=box.scrollHeight>box.clientHeight+40
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches)jumpFocusAnimation=element.animate([{opacity:.55},{opacity:1}],{duration:180,easing:'ease-out'})
    }
  }finally{
    job.detach()
    if(messageJumpJob===job){
      messageJumpJob=undefined
      messageJumpInProgress=false
    }
  }
}

async function copyText(text: string) {
  const t = String(text || '')
  if (!t) return
  try {
    await navigator.clipboard.writeText(t)
    showToast('已复制', 'primary')
  } catch {
    showToast('复制失败')
  }
}

function quoteToComposer(text: string) {
  const t = String(text || '').trim()
  if (!t) return
  const quoted = t
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  draftField.value?.insertText(quoted+'\n')
  scheduleDraftSave()
  focusComposer()
}

async function openRemoteWindow(windowId: string) {
  await router.push(`/remote/${encodeURIComponent(windowId)}`)
}

type PendingComposerSubmission={id:string;chatId:string;document:ComposerDocument;text:string;failed:boolean;recoveryId?:string}
const pendingSubmissions=ref<PendingComposerSubmission[]>([])
const composerStaging=ref<string|null>(null)
const visibleSubmissions=computed(()=>pendingSubmissions.value.filter(item=>item.chatId===activeId.value&&(!item.failed||!item.recoveryId)))
function snapshotAccepted(document:ComposerDocument){let key:string;try{key=composerSubmissionKey(document)}catch{return false}const same=(candidate?:ComposerDocument)=>{try{return !!candidate&&composerSubmissionKey(candidate)===key}catch{return false}};return !!active.value?.messages.some(message=>same(message.meta?.document))||!!active.value?.queuedMessages?.some(entry=>same(entry.document))}
const visibleDraftRecoveries=computed(()=>active.value?.draftRecoveries?.filter(entry=>!snapshotAccepted(entry.document)&&!pendingSubmissions.value.some(item=>item.recoveryId===entry.id&&!item.failed))||[])
async function restoreFailedSubmission(id:string){const item=pendingSubmissions.value.find(item=>item.id===id);if(!item)return;try{if(!await recoverComposerDocument(item.document))return;await flushDraftSave(item.chatId);pendingSubmissions.value=pendingSubmissions.value.filter(item=>item.id!==id)}catch{showToast('内容已保留，请确认草稿同步后再移除快照。','warning')}}
function dismissFailedSubmission(id:string){pendingSubmissions.value=pendingSubmissions.value.filter(item=>item.id!==id)}
async function dismissDraftRecovery(id:string,owner=activeId.value){const chatId=owner;if(!chatId)return;try{const chat=await window.navora?.chats.dismissDraftRecovery(chatId,id);if(chat&&activeId.value===chatId)active.value={...active.value!,draftRecoveries:chat.draftRecoveries}}catch{showToast('暂时无法移除这份快照，请重试。','warning')}}
async function restoreDraftRecovery(id:string){const entry=active.value?.draftRecoveries?.find(entry=>entry.id===id);if(!entry)return;try{if(!await recoverComposerDocument(entry.document))return;await flushDraftSave(entry.document.chatId);await dismissDraftRecovery(id,entry.document.chatId)}catch{showToast('内容已放回编辑器；保存成功后再移除快照。','warning')}}
async function retryDraftRecovery(id:string){const entry=active.value?.draftRecoveries?.find(entry=>entry.id===id);if(!entry||sending.value)return;await submitComposerSnapshot(entry.document,false,id)}
async function send(){
  const chatId=activeId.value
  if(!chatId||!window.navora||sending.value||composerComposing.value||!canSend.value)return
  const modelIdentity=captureModelIdentity()
  if(!modelIdentity)return
  const clicked=normalizeComposerDocument(JSON.parse(JSON.stringify(composerDocument.value)),chatId)
  composerStaging.value=chatId
  sending.value=true
  try{
    await flushDraftSave(chatId)
    if(activeId.value!==chatId)return
    const snapshot={...clicked,revision:draftState.baseRevision()}
    await submitComposerSnapshot(snapshot,true,undefined,modelIdentity)
  }catch(error){showToast(error instanceof Error&&error.message==='composer_draft_conflict'?'请先处理草稿同步冲突，再发送。':'草稿保存尚未确认，内容保留在编辑器中，请重试。','warning')}
  finally{if(composerStaging.value===chatId)composerStaging.value=null;sending.value=false}
}
function captureModelIdentity():ModelSelectionIdentity|undefined{
  if(!active.value||modelSelectionInvalid.value||modelSelectionBusy.value||executionModeBusy.value||modelLoading.value||modelLoadError.value){showToast('请等待模型选择保存完成后再发送。','warning');return}
  try{return confirmedModelSelection({ai:{providers:aiProviders.value,default_provider:aiDefaultProviderId.value}},active.value)}catch{showToast('请先选择模型，或到设置中添加服务商。','warning')}
}
async function submitComposerSnapshot(snapshot:ComposerDocument,rotate:boolean,knownRecoveryId?:string,selectedIdentity?:ModelSelectionIdentity){
  if(!window.navora)return
  const modelIdentity=selectedIdentity||captureModelIdentity()
  if(!modelIdentity)return
  let compiled:ReturnType<typeof compileComposerDocument>;try{compiled=compileComposerDocument(snapshot)}catch(error){showToast(composerErrorMessage(error)||'无法读取这份提交，原始内容已保留。','warning');return}
  const chatId=snapshot.chatId,wasRunning=!!runningChats.value[chatId],submissionMode=Object.values(questionnaireRecords.value).some(record=>record.chatId===chatId&&record.status==='pending')?'insert' as const:'queue' as const
  if((submissionMode==='insert'||activeFileTab.value?.kind==='questionnaire'&&activeFileTab.value.chatId===chatId)&&!await flushQuestionnaireDraft()){
    showToast('请先保存问卷草稿或处理版本冲突，再切回聊天。','warning')
    return
  }
  if(compiled.content.length>maxComposerChars.value){showToast(`内容超过上限（${maxComposerChars.value} 字），请缩小范围或移除部分资料。`,'warning');return}
  const id=composerSubmissionKey(snapshot)
  if(pendingSubmissions.value.some(item=>item.id===id&&!item.failed))return
  sending.value=true
  const pending:PendingComposerSubmission={id,chatId,document:snapshot,text:compiled.content,failed:false,recoveryId:knownRecoveryId}
  pendingSubmissions.value=[...pendingSubmissions.value.filter(item=>item.id!==id),pending]
  let staged=false
  if(rotate)composerStaging.value=chatId
  try{
    // Persist the frozen submission before allowing a separate next draft.
    // A crash or lost acknowledgement leaves an explicit, idempotent recovery.
    if(!pending.recoveryId){const saved=await window.navora.chats.saveDraftRecovery(chatId,snapshot);pending.recoveryId=saved?.draftRecoveries?.find(entry=>{try{return composerSubmissionKey(entry.document)===id}catch{return false}})?.id;if(!pending.recoveryId)throw Error('无法保存提交快照');if(activeId.value===chatId)active.value={...active.value!,draftRecoveries:saved?.draftRecoveries}}
    staged=true
    // Keep the frozen draft visible until the host acknowledges this idempotent submission.
    if(activeId.value===chatId)resumeMessageFollow()
    clearFollowups(chatId);clearChatError(chatId)
    const sent=await window.navora.agent.submit(chatId,{content:compiled.content,refs:compiled.refs,document:snapshot,clientMessageId:id,draftRevision:snapshot.revision,modelIdentity},submissionMode)
    if(!sent)throw Error('提交未获得确认')
    draftState.acknowledge(sent,snapshot)
    if(pending.recoveryId){const cleaned=await window.navora.chats.dismissDraftRecovery(chatId,pending.recoveryId).catch(()=>null);if(cleaned)sent.draftRecoveries=cleaned.draftRecoveries}
    pendingSubmissions.value=pendingSubmissions.value.filter(item=>item.id!==id)
    const running=await window.navora.agent.isRunning(chatId);setRunning(chatId,running)
    if(activeId.value===chatId){active.value=sent;if(running&&!wasRunning){phase.value='thinking';phaseDetail.value='正在理解任务…'}await scrollMessages(true)}
    await refreshList()
  }catch(error){
    const retained=pendingSubmissions.value.find(item=>item.id===id);if(retained){retained.failed=true;retained.recoveryId=pending.recoveryId}
    if(staged&&activeId.value===chatId){const chat=await window.navora.chats.get(chatId).catch(()=>null);if(chat)active.value={...active.value!,draftRecoveries:chat.draftRecoveries}}
    const stillRunning=await window.navora.agent.isRunning(chatId).catch(()=>wasRunning);setRunning(chatId,stillRunning)
    const raw=error instanceof Error?error.message:'发送失败';rememberChatError(chatId,raw)
    const detail=composerErrorMessage(error)||formatAgentError(raw).message
    showToast(staged?`${detail}；完整内容和来源已保留，可重试或放回编辑器。`:'无法保存提交快照，内容仍保留在编辑器中。','warning')
  }finally{if(composerStaging.value===chatId)composerStaging.value=null;sending.value=false;if(activeId.value===chatId)focusComposer()}
}

async function retryLast() {
  const chatId = activeId.value
  if (!chatId || !window.navora || agentRunning.value || sending.value || retrying.value) return
  retrying.value = true
  clearChatError(chatId)
  clearFollowups(chatId)
  resumeMessageFollow()
  try {
    active.value = await window.navora.agent.retry(chatId)
    const running = await window.navora.agent.isRunning(chatId)
    setRunning(chatId, running)
    if (running) {
      phase.value = 'thinking'
      phaseDetail.value = '正在重试…'
    }
    await refreshList()
    await scrollMessages(true)
  } catch (e) {
    console.error(e)
    setRunning(chatId, false)
    const raw = e instanceof Error ? e.message : '重试失败'
    rememberChatError(chatId, raw)
    const formatted = formatAgentError(raw)
    showToast(formatted.message, formatted.code === 'api_key_missing' ? 'warning' : 'error')
  } finally {
    retrying.value = false
    focusComposer()
  }
}

async function stopAgent() {
  if (!window.navora || !activeId.value) return
  await window.navora.agent.stop(activeId.value)
  focusComposer()
}

async function respondPerm(decision: PermissionDecision) {
  const request=permReq.value
  if(!window.navora||!request)return
  await submitDecision(decisionSubmissions,request.id,()=>window.navora!.permission.respond(request.id,decision),()=>removePermRequest(request.id))
}
async function respondAsk(answer:string,source:'option'|'custom'|'deny') {
  const request=activePendingAsk.value
  if(!window.navora||!request)return
  await submitDecision(decisionSubmissions,request.id,()=>window.navora!.agent.respondAsk(request.id,{answer,source}),()=>clearPendingAsk(request.chatId,request.id))
}
async function respondAskOption(option:string){await respondAsk(option,'option')}
async function respondAskCustomText(text:string){const value=String(text||'').trim();if(value)await respondAsk(value,'custom')}
async function respondAskDeny(){await respondAsk('','deny')}

function scrollToInlineDecision() {
  void nextTick(async () => {
    await scrollMessages(true)
    inlineDecisionEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function rememberPendingAsk(req: AgentAskRequest) {
  trackAskExpiry(req)
  pendingAsks.value = { ...pendingAsks.value, [req.chatId]: req }
}

function clearPendingAsk(chatId: string, id?: string,preserveDraft=false) {
  const cur = pendingAsks.value[chatId]
  if (!cur) return
  if (id && cur.id !== id) return
  clearAskExpiry(cur.id)
  if(!preserveDraft)clearDecisionDraft(cur.id)
  closeAskUi(cur.id)
  delete decisionSubmissions[cur.id]
  const next = { ...pendingAsks.value }
  delete next[chatId]
  pendingAsks.value = next
}

function clearPendingAskById(id: string) {
  for (const [chatId, req] of Object.entries(pendingAsks.value)) {
    if (req.id === id) {
      clearPendingAsk(chatId, id,isDecisionSubmitting(id))
      return
    }
  }
  clearAskExpiry(id)
  if(!isDecisionSubmitting(id))clearDecisionDraft(id)
}

function openAskDialog(req: AgentAskRequest) {
  trackAskExpiry(req)
  rememberPendingAsk(req)
  askReq.value = req
  if (req.chatId === activeId.value || req.parentChatId === activeId.value) {
    phase.value = 'awaiting_user'
    phaseDetail.value = req.question.slice(0, 80)
  }
  phaseByChat.value = {
    ...phaseByChat.value,
    [req.chatId]: { phase: 'awaiting_user', detail: req.question.slice(0, 80) },
  }
  scrollToInlineDecision()
}

async function openPendingAsk(chatId: string) {
  const questionnaire=pendingQuestionnaireForSidebar(chatId)
  if(questionnaire){await openQuestionnaireRecord(questionnaire);return}
  const req = pendingAskForSidebar(chatId)
  if (!req) return
  const owner=chats.value.find(chat=>chat.id===req.chatId)||await window.navora?.chats.get(req.chatId)
  if(owner?.kind==='sub'){
    await routeConversationTarget(req.chatId);await nextTick()
    if(activeFileTab.value?.kind==='subchats'&&activeFileTab.value.selectedSubchatId===req.chatId)await fileWorkspace.value?.locateSubchatPending(req.id)
    return
  }
  if (activeId.value !== chatId) await selectChat(chatId)
  scrollToInlineDecision()
}

function closeAskUi(id?: string) {
  if (id && askReq.value && askReq.value.id !== id) return
  askReq.value = null
}

watch(activeId, async (id, _previous, onCleanup) => {
  let stale=false
  onCleanup(()=>{stale=true})
  tree.value=[]
  if (!id) return
  const [nextTree,running]=await Promise.all([window.navora?.browser.tree(id),window.navora?.agent.isRunning(id)])
  if(stale)return
  tree.value=nextTree||[]
  syncBrowserTabs(tree.value)
  agentRunning.value=running||false
})

watch(settingsOpen, async (open, wasOpen) => {
  if (!wasOpen || open) return
  await loadUiPrefs()
  await refreshSettingsPermissions()
  const next = { ...chatErrors.value }
  let changed = false
  for (const [chatId, err] of Object.entries(next)) {
    if (err.code !== 'api_key_missing') continue
    const chat = chats.value.find((c) => c.id === chatId) || (active.value?.id === chatId ? active.value : null)
    const provider = resolveProvider(
      aiProviders.value,
      aiDefaultProviderId.value,
      chat?.providerId,
    )
    if (provider && providerKeyOk.value[provider.id] === true) {
      delete next[chatId]
      changed = true
    }
  }
  if (changed) chatErrors.value = next
})

// Agent 可能通过工具写入新服务商/模型；打开菜单时再拉一次，避免只靠缓存。
watch(modelMenuOpen, async (open) => {
  if (!open)return
  modelQuery.value=''
  await refreshAiProviders()
  await nextTick()
  requestAnimationFrame(()=>document.querySelector('.model-panel-options [aria-checked=true]')?.scrollIntoView({block:'nearest'}))
})

watch(agentRunning, (running, wasRunning) => {
  if (wasRunning && !running) void refreshAiProviders()
})

watch(isMobileLayout, (mobile) => {
  if (!mobile) closeChatSwipe()
})

watch(
  () => [route.query.settings,route.query.settingsRequest,route.query.settingsReturn],
  async([v]) => {
    if(typeof v!=='string'||!['1','true','basic','appearance','model','browser','workspace','skills','plugins','remote','permissions','fork','subchat','about'].includes(v))return
    const request=typeof route.query.settingsRequest==='string'?route.query.settingsRequest:undefined
    const returnId=typeof route.query.settingsReturn==='string'?route.query.settingsReturn:undefined
    const accepted=await openSettings(v==='1'||v==='true'?undefined:v,{returnId})
    if(request)await window.navora?.app.settingsHandled(request,accepted===true).catch(()=>{})
    if(route.query.settings!==v||(request&&route.query.settingsRequest!==request))return
    const q = { ...route.query }
    delete q.settings
    delete q.settingsRequest
    delete q.settingsReturn
    void router.replace({ path: route.path || '/', query: q })
  },
  { immediate: true },
)

onMounted(async () => {
  window.addEventListener('keydown', onAppShortcut)
  window.addEventListener(OPEN_QUESTIONNAIRE_EVENT,onOpenQuestionnaireEvent)
  if (!window.navora) {
    console.warn('Navora API unavailable (open via Electron)')
    return
  }
  unsubscribeQuestionnaires=window.navora.questionnaires?.onChanged(record=>acceptQuestionnaireRecord(record,true))
  if(!isWebRemote())unsubQuitRequested=window.navora.app.onQuitRequested?.(request=>{onMoreQuit();if(request.error)showToast(request.error,'warning')})
  void refreshQuestionnaires()
  void window.navora.app.info().then(info=>{applicationVersion.value=info.version}).catch(()=>{})
  if(!isWebRemote())unsubFileTransfer=window.navora.fileTabs.onTransfer(async event=>{
    try{
      const target=chats.value.find(chat=>chat.id===event.viewerChatId)||await window.navora!.chats.get(event.viewerChatId)
      const viewer=target?.kind==='sub'&&target.parentChatId?target.parentChatId:event.viewerChatId
      transferFileTab({...event,viewerChatId:viewer})
      if(event.kind==='open'){if(viewer!==activeId.value)await selectChat(viewer);settingsOpen.value=false;creatorKind.value=null;browserWorkspaceMode.value=false;pluginWorkspaceMode.value=false;fileManagerMode.value=false;workspaceConversationActive.value=false;if(sidebarRail.value.active)activateSidebar('chats',false)}
      if(event.requestId)await window.navora!.fileTabs.completeTransfer(event.requestId)
    }catch(e){if(event.requestId)await window.navora!.fileTabs.completeTransfer(event.requestId,String(e))}
  })
  if(!isWebRemote())unsubBrowserPresent=window.navora.browser.workspace.onPresent(async payload=>{
    if(payload.hidden){const displayed=browserWorkspaceActive.value?browserWorkspaceTab.value:activeFileTab.value;if(displayed?.pageId===payload.pageId){browserPresentRequest++;hideFileWorkspace();if(browserWorkspaceActive.value)activateSidebar('chats',false)}return}
    const request=++browserPresentRequest
    const resourceOwner=chats.value.find(chat=>chat.id===payload.chatId)||await window.navora!.chats.get(payload.chatId)
    const parentId=resourceOwner?.kind==='sub'&&resourceOwner.parentChatId?resourceOwner.parentChatId:payload.chatId
    if(parentId!==activeId.value){if(browserWorkspaceActive.value)await selectChat(parentId);else await openResourceChat(parentId)}
    if(request!==browserPresentRequest||parentId!==activeId.value)return
    const selection=chatSelection
    if(!tree.value.some(session=>session.windows.some(page=>page.windowId===payload.pageId&&page.presentation==='embedded'))){const nextTree=await window.navora!.browser.tree(parentId);if(request!==browserPresentRequest||selection!==chatSelection||parentId!==activeId.value)return;tree.value=nextTree}
    syncBrowserTabs(tree.value);workspaceConversationActive.value=false
    const presented=await presentBrowserResource(payload.pageId,payload.chatId)
    if(!presented||request!==browserPresentRequest||selection!==chatSelection||parentId!==activeId.value)return
    if(payload.annotation){activateSidebar('chats',false);addRef(payload.annotation)}
  })
  unsubTree = window.navora.browser.onTreeUpdated((payload) => {
    windowCounts.value = payload.counts
    if (payload.chatId === activeId.value) {
      tree.value = payload.tree
      syncBrowserTabs(payload.tree)
      const winIds = new Set(payload.tree.flatMap((s) => s.windows.map((w) => w.windowId)))
      const sessIds = new Set(payload.tree.map((s) => s.sessionId))
      markBrowserSources(winIds,sessIds)
    }else if(chats.value.some(chat=>chat.id===payload.chatId&&chat.kind==='sub'&&chat.parentChatId===activeId.value)){
      tree.value=[...tree.value.filter(session=>session.chatId!==payload.chatId),...payload.tree.filter(session=>session.chatId===payload.chatId)]
      syncBrowserTabs(tree.value)
    }
  })
  unsubConfig = window.navora.config.onChanged?.(async (cfg) => {
    applyUiPrefs(cfg)
    await refreshAiProviders(cfg)
    await refreshSettingsPermissions()
  })
  unsubChats = window.navora.chats.onChanged?.(async (ev) => {
    if (ev.type === 'removed') {
      const wasActive = activeId.value === ev.chatId
      if (askReq.value?.chatId === ev.chatId) closeAskUi()
      clearPendingAsk(ev.chatId)
      if (wasActive) {
        activeId.value = ''
        active.value = null
        tree.value = []
        phase.value = 'idle'
        phaseDetail.value = ''
        applyDraftLocally('', 0)
      }
      await refreshList()
      return
    }
    await refreshList()
    if (ev.type === 'upsert' && ev.chatId === activeId.value && window.navora) {
      const fresh = await window.navora.chats.get(ev.chatId)
      if (!fresh) return
      if (!agentRunning.value) {
        active.value = fresh
      } else {
        const localLen = active.value?.messages?.length || 0
        const freshLen = fresh.messages?.length || 0
        // Retry trims failed turns; prefer shorter fresh history over stale local.
        if (freshLen < localLen) {
          active.value = fresh
        } else {
          active.value = {
            ...active.value!,
            ...fresh,
            messages: active.value?.messages || fresh.messages,
          }
        }
      }
      draftState.acceptRemote(fresh)
    }
  })
  unsubAgent = window.navora.agent.onEvent(async (ev) => {
    if (ev.type === 'answer_preview') {
      const next = { ...liveAnswerByChat.value }
      if (ev.content) next[ev.chatId] = ev.content
      else delete next[ev.chatId]
      liveAnswerByChat.value = next
      if (ev.chatId === activeId.value) await scrollMessages()
    }
    if (ev.type === 'status') {
      if (!ev.running) {
        const next = { ...liveAnswerByChat.value }
        delete next[ev.chatId]
        liveAnswerByChat.value = next
      }
      setRunning(ev.chatId, ev.running)
      if(quitDialog.value)void quitConfirmation.refresh()
    }
    if (ev.type === 'title') {
      const idx = chats.value.findIndex((c) => c.id === ev.chatId)
      const fromAi = ev.fromAi === true
      if (idx >= 0) {
        const next = chats.value.slice()
        next[idx] = {
          ...next[idx],
          title: ev.title,
          ...(fromAi ? { titleGenerated: true } : {}),
        }
        chats.value = next
      }
      if (active.value?.id === ev.chatId) {
        active.value = {
          ...active.value,
          title: ev.title,
          ...(fromAi ? { titleGenerated: true } : {}),
        }
      }
    }
    if (ev.type === 'phase') {
      phaseByChat.value = {
        ...phaseByChat.value,
        [ev.chatId]: { phase: ev.phase, detail: ev.detail || '' },
      }
      if (ev.chatId === activeId.value) {
        phase.value = ev.phase
        phaseDetail.value = ev.detail || ''
        await scrollMessages()
      }
    }
    if (ev.type === 'reasoning') {
      if (ev.status === 'clear') {
        const next = { ...liveReasoningByChat.value }
        delete next[ev.chatId]
        liveReasoningByChat.value = next
        const forced = { ...liveReasoningForced.value }
        delete forced[ev.chatId]
        liveReasoningForced.value = forced
      } else if (ev.content?.trim()) {
        liveReasoningByChat.value = {
          ...liveReasoningByChat.value,
          [ev.chatId]: {
            content: ev.content,
            status: 'live',
            round: ev.round,
          },
        }
      }
      if (ev.chatId === activeId.value) {
        await nextTick()
        if (liveReasoningOpen.value && liveReasoningBodyEl.value) {
          liveReasoningBodyEl.value.scrollTop = liveReasoningBodyEl.value.scrollHeight
        }
        await scrollMessages()
      }
    }
    if (ev.type === 'message') {
      const isActive = ev.chatId === activeId.value
      if (isActive) {
        upsertMessage(ev.message)
        if (ev.message.role === 'tool') {
          const status = ev.message.meta?.status
          if (status === 'running') {
            expandedTools.value = { ...expandedTools.value, [ev.message.id]: false }
          } else if (status === 'error') {
            expandedTools.value = { ...expandedTools.value, [ev.message.id]: false }
          }
          void hydrateToolMedia(ev.message, ev.chatId)
        }
      }
      if (ev.message.role === 'log' && isErrorRunLog(ev.message)) {
        // Persist in chatErrors even if the separate `error` event is missed / cleared.
        const detail =
          String(ev.message.meta?.summary || '').trim() ||
          logFullText(ev.message).split(/\r?\n/).find((l) => l.trim())?.trim() ||
          'Agent 出错'
        rememberChatError(ev.chatId, detail)
        if (isActive) void scrollMessages(true)
      }
      if (ev.message.role === 'log' && isStopRunLog(ev.message)) {
        rememberChatError(ev.chatId, String(ev.message.meta?.summary || '').trim() || '用户终止')
        if (isActive) void scrollMessages(true)
      }
      if (isActive) await scrollMessages()
    }
    if (ev.type === 'message_update' && ev.chatId === activeId.value) {
      upsertMessage(ev.message)
      if (ev.message.role === 'tool' && ev.message.meta?.status === 'error') {
        expandedTools.value = { ...expandedTools.value, [ev.message.id]: false }
      }
      if (ev.message.role === 'tool') void hydrateToolMedia(ev.message, ev.chatId)
      const downloading =
        ev.message.role === 'tool' &&
        ev.message.meta?.status === 'running' &&
        !!ev.message.meta?.downloadProgress
      if (!downloading) await scrollMessages()
    }
    if (ev.type === 'error') {
      setRunning(ev.chatId, false)
      rememberChatError(ev.chatId, ev.error || 'Agent 出错')
      const formatted = formatAgentError(ev.error || 'Agent 出错')
      const tip =
        ev.chatId === activeId.value
          ? formatted.message
          : `${chats.value.find((c) => c.id === ev.chatId)?.title || '其他 Chat'}：${formatted.message}`
      showToast(tip, formatted.code === 'api_key_missing' ? 'warning' : 'error')
      if (ev.chatId === activeId.value) {
        if(!messageReadingIntent)stickToBottom.value=true
        void scrollMessages(true)
      }
    }
    if (ev.type === 'done') {
      const incoming = ev.followups || []
      if (showFollowupSuggestions.value) {
        setFollowups(ev.chatId, incoming)
      } else {
        setFollowups(
          ev.chatId,
          incoming.filter((s) => typeof s !== 'string' && s.action?.type === 'store_install'),
        )
      }
      if (ev.chatId === activeId.value) {
        active.value = (await window.navora?.chats.get(ev.chatId)) || active.value
        const failed = lastUserTurnFailed(active.value?.messages)
        if (failed.failed && !runningChats.value[ev.chatId]) {
          rememberChatError(
            ev.chatId,
            failed.reason === 'stop'
              ? `user_stopped:${failed.summary || '用户终止'}`
              : failed.summary || 'Agent 出错',
          )
        }
        await refreshList()
        await scrollMessages(true)
        focusComposer()
      } else if (ev.parentChatId === activeId.value) {
        await refreshList()
        // Parent card may have been updated via message_update already.
      }
    }
    if (ev.type === 'subchat') {
      await refreshList()
      if (ev.parentChatId === activeId.value) {
        const parent = await window.navora?.chats.get(ev.parentChatId)
        if (parent) active.value = parent
      }
      if (ev.chatId === activeId.value) {
        active.value = (await window.navora?.chats.get(ev.chatId)) || active.value
      }
    }
  })
  unsubPerm = window.navora.permission.onRequest((req) => {
    if(!pendingPermRequests.value.some(request=>request.id===req.id))pendingPermRequests.value=[...pendingPermRequests.value,req]
    trackPermExpiry(req)
    const requestChat=chats.value.find(chat=>chat.id===req.chatId)
    if (req.chatId === activeId.value || requestChat?.kind==='sub'&&requestChat.parentChatId===activeId.value) {
      phase.value = 'awaiting_permission'
      phaseDetail.value = `等待授权：${req.capability}`
      scrollToInlineDecision()
    }
  })
  unsubPermCancel = window.navora.permission.onCancel((id) => {
    if(deferDecisionCancellation(decisionSubmissions,id))return
    removePermRequest(id)
  })
  unsubAsk = window.navora.agent.onAsk((req) => {
    rememberPendingAsk(req)
    phaseByChat.value = {
      ...phaseByChat.value,
      [req.chatId]: { phase: 'awaiting_user', detail: req.question.slice(0, 80) },
    }
    if (req.chatId === activeId.value || req.parentChatId === activeId.value) {
      openAskDialog(req)
    }
  })
  unsubAskCancel = window.navora.agent.onAskCancel((payload) => {
    const id = typeof payload === 'string' ? payload : payload.id
    const reason = typeof payload === 'string' ? undefined : payload.reason
    if(deferDecisionCancellation(decisionSubmissions,id))return
    clearPendingAskById(id)
    closeAskUi(id)
    if (reason === 'timeout') {
      showToast('询问已超时，Agent 将按超时继续', 'warning')
    }
  })
  tickTimer = setInterval(() => {
    if (
      agentRunning.value ||
      showInlinePendingAsk.value ||
      showInlinePerm.value
    ) {
      nowTick.value = Date.now()
    }
  }, 500)

  const layoutTick = () => {
    if (stickToBottom.value) void scrollMessages(true)
    else if(conversationIsVisible.value&&!restoringConversation&&!messageJumpInProgress&&msgBox.value?.checkVisibility()){
      // Resizing is not a user request to resume following the live answer.
      // An explicit message jump can be close to the bottom and must stay put.
      showJumpBottom.value=msgBox.value.scrollHeight>msgBox.value.clientHeight+40
      if(activeId.value)conversationReading={chatId:activeId.value,top:msgBox.value.scrollTop,follow:false}
    }
    remeasureAllLogOverflow()
  }
  stopMessageResizeWatch = watch(msgBox, (element) => {
    resizeObserver?.disconnect()
    if (element && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(layoutTick)
      resizeObserver.observe(element)
      layoutTick()
    }
  }, { flush: 'post', immediate: true })
  onWinResize = () => layoutTick()
  window.addEventListener('resize', onWinResize)

  await loadUiPrefs()
  await refreshSettingsPermissions()
  await refreshList()
  if (!chats.value.length) await createChat()
  await finishWindowStartup()
})

onActivated(() => {
  void refreshList()
  void refreshQuestionnaires()
  void loadUiPrefs()
  void refreshSettingsPermissions()
  if (activeId.value && window.navora) {
    void window.navora.agent.isRunning(activeId.value).then((running) => {
      setRunning(activeId.value!, running)
      agentRunning.value = running
      if (running) {
        const saved = phaseByChat.value[activeId.value!]
        if (saved && saved.phase !== 'idle') {
          phase.value = saved.phase
          phaseDetail.value = saved.detail || ''
        }
      }
    })
  }
})

onUnmounted(() => {
  clearTimeout(copiedMessageTimer)
  chatSelection++
  chatTransition?.cancel()
  window.removeEventListener('keydown', onAppShortcut)
  window.removeEventListener(OPEN_QUESTIONNAIRE_EVENT,onOpenQuestionnaireEvent)
  unsubscribeQuestionnaires?.()
  unsubQuitRequested?.()
  void flushDraftSave(activeId.value).catch(()=>{})
  unsubTree?.()
  unsubBrowserPresent?.()
  unsubFileTransfer?.()
  unsubConfig?.()
  unsubAgent?.()
  unsubChats?.()
  unsubPerm?.()
  unsubPermCancel?.()
  unsubAsk?.()
  unsubAskCancel?.()
  if (tickTimer) clearInterval(tickTimer)
  if (onWinResize) window.removeEventListener('resize', onWinResize)
  resizeObserver?.disconnect()
  stopMessageResizeWatch?.()
  for (const ro of logResizeObservers.values()) ro.disconnect()
  logResizeObservers.clear()
  logMeasureEls.clear()
  revokeAllMediaUrls()
})
</script>

<style scoped>
.annotation-chat-status{margin:10px 0;font-size:12px;color:var(--navora-muted)}
.questionnaire-pending-dock{width:min(720px,100%);margin-bottom:8px}.questionnaire-pending-dock>button{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:1px solid var(--navora-stroke);border-radius:10px;background:var(--appearance-well,var(--navora-surface));color:var(--navora-ink);text-align:left;cursor:pointer}.questionnaire-pending-dock>button:hover{background:var(--control-hover)}.questionnaire-pending-dock>button:focus-visible{outline:2px solid var(--navora-accent);outline-offset:2px}.questionnaire-pending-dock>button>svg{color:var(--navora-accent);flex:none}.questionnaire-pending-dock>button>span:not(.questionnaire-dock-action){display:flex;flex-direction:column;min-width:0}.questionnaire-pending-dock strong{font-size:13px;font-weight:600;overflow-wrap:anywhere}.questionnaire-pending-dock small{font-size:12px;color:var(--navora-muted)}.questionnaire-dock-action{margin-left:auto;flex:none;font-size:12px;color:var(--navora-accent)}
.composer-pending-submit,.composer-draft-recovery{width:min(720px,100%);box-sizing:border-box;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 12px;border:1px solid var(--navora-stroke,#dbe3ed);border-radius:10px;margin:0 0 8px;background:var(--appearance-well,#f7f9fc);color:var(--navora-muted,#78869a);font-size:12px}
.composer-pending-submit>span,.composer-draft-recovery>span{margin-right:auto}.composer-pending-submit details,.composer-draft-recovery details{flex:0 0 100%;font-size:11px}.composer-pending-submit summary,.composer-draft-recovery summary{color:var(--navora-accent,#3f6c9b)}.composer-pending-submit pre,.composer-draft-recovery pre{max-height:150px;overflow:auto;white-space:pre-wrap;font:inherit;padding:8px;background:var(--navora-surface,#fff);border-radius:6px;color:var(--navora-ink,#384b63)}.composer-pending-submit button,.composer-draft-recovery button{padding:3px 7px;border-radius:5px;color:var(--navora-accent,#3f6c9b)}.composer-pending-submit button:hover,.composer-draft-recovery button:hover{background:var(--control-hover,#eaf0f7)}.composer-validation{width:min(720px,100%);font-size:12px;line-height:1.5;color:var(--control-danger,#ad6456);margin:0 0 8px}
.conversation-content{display:contents}
.plugins-sidebar-host{display:flex;flex:1;flex-direction:column;min-height:0;height:100%}
.shell:not(.mobile-layout)>.content-surface>.main:has(>.plugin-workspace.is-active){grid-template-rows:minmax(0,1fr)}
.shell.mobile-layout>.content-surface>.main:has(>.plugin-workspace.is-active){grid-template-rows:auto minmax(0,1fr)}
.shell:not(.mobile-layout)>.content-surface>.main:has(>.file-manager.is-active){grid-template-rows:minmax(0,1fr)}
.shell.mobile-layout>.content-surface>.main:has(>.file-manager.is-active){grid-template-rows:auto minmax(0,1fr)}
.shell {
  position: relative;
  display: grid;
  grid-template-columns: clamp(220px, 26vw, 280px) minmax(0, 1fr);
  height: 100vh;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  background: #eef2f5;
  user-select: none;
  -webkit-user-select: none;
}
.sidebar {
  display: flex;
  flex-direction: column;
  background: #15202b;
  color: #ecf0f1;
  /* 右侧不留白，让滚动条贴边；内容靠子元素 padding/margin 与滚动条拉开 */
  padding: 16px 0 12px 12px;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.shell.frameless .sidebar {
  padding-top: 0;
}
.brand {
  width: 100%;
  min-width: 0;
  padding: 14px 12px 12px 0;
  box-sizing: border-box;
}
.brand.app-drag {
  -webkit-app-region: drag;
}
.brand-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 28px;
}
.brand-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}
.brand-logo {
  width: 20px;
  height: 20px;
  object-fit: contain;
  flex-shrink: 0;
  display: block;
}
.brand-name {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brand-search-btn {
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  margin-left: auto;
  width: 32px;
  height: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: transparent;
  color: rgba(236, 240, 241, 0.85);
  font-size: 0.85rem;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease;
}
.brand-search-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  margin: 0 12px 8px 0;
  box-sizing: border-box;
  min-height: 36px;
}
.chat-toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.toolbar-swap-enter-active,
.toolbar-swap-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.toolbar-swap-enter-from {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
.toolbar-swap-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
.batch-btn-pop-enter-active,
.batch-btn-pop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.batch-btn-pop-enter-from,
.batch-btn-pop-leave-to {
  opacity: 0;
  transform: scale(0.72);
}
.batch-check-enter-active,
.batch-check-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    width 0.18s ease,
    margin 0.18s ease;
  overflow: hidden;
}
.batch-check-enter-from,
.batch-check-leave-to {
  opacity: 0;
  transform: scale(0.5);
  width: 0 !important;
  margin-right: 0 !important;
}
/* Keep the action strip after caption drag regions in DOM order: native hit testing uses that order. */
.chat-list-actions { display:flex; align-items:center; gap:6px; flex-shrink:0; padding:3px 0 9px; }
.chat-list-actions button { height:34px; display:flex; align-items:center; gap:9px; padding:0 10px; border:1px solid #d9e0e9; border-radius:8px; background:#fff; color:#4a607c; font:inherit; font-size:12px; cursor:default; transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease; }
.chat-list-actions .chat-new-action { flex:1; min-width:0; }
.chat-list-actions .chat-search-action { justify-content:center; width:34px; padding:0; flex-shrink:0; }
.chat-list-actions svg { width:14px; height:14px; flex-shrink:0; }
.chat-list-actions kbd { margin-left:auto; color:#8996a8; font-size:10px;line-height:1.2;font-family:inherit; white-space:nowrap; }
.chat-list-actions button:hover { background:#eaf0f7; border-color:#bfcede; color:#34577e; }
.chat-list-actions button:focus-visible { outline:2px solid #537ab9; outline-offset:2px; }
@media(prefers-reduced-motion:reduce){.chat-list-actions button{transition:none}}
.new-chat-btn {
  flex: 1;
  min-width: 0;
  min-height: 36px !important;
  height: 36px !important;
  padding: 0 12px !important;
  margin-right: 0;
  font-size: 0.85rem !important;
  font-weight: 600 !important;
  letter-spacing: 0;
  color: #20252c !important;
}
.chat-toolbar-icon-btn {
  flex-shrink: 0;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(236, 240, 241, 0.92);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease,
    transform 0.15s ease;
}
.chat-toolbar-icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
}
.chat-toolbar-icon-btn:active {
  transform: scale(0.94);
}
.batch-select-btn {
  flex: 1;
  min-width: 0;
  min-height: 36px !important;
  height: 36px !important;
  padding: 0 10px !important;
  font-size: 0.82rem !important;
  font-weight: 600 !important;
  color: #39414d !important;
  background: #e8eaee !important;
}
.batch-list-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 12px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.batch-pin-btn {
  flex: 1;
  min-width: 0;
  min-height: 44px !important;
  height: 44px !important;
  padding: 0 12px !important;
  font-size: 0.88rem !important;
  font-weight: 600 !important;
  color: #39414d !important;
  background: #e8eaee !important;
}
.batch-pin-icon {
  margin-right: 6px;
  font-size: 0.85em;
  transform: rotate(45deg);
}
.batch-delete-btn {
  flex: 1;
  min-width: 0;
  min-height: 44px !important;
  height: 44px !important;
  padding: 0 14px !important;
  font-size: 0.95rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.02em;
}
.new-chat-icon {
  margin-right: 8px;
  font-size: 0.9em;
}
.chat-batch-check {
  flex-shrink: 0;
  width: 1.1rem;
  margin-right: 8px;
  color: rgba(236, 240, 241, 0.45);
  font-size: 0.95rem;
  line-height: 1;
  transition:
    color 0.15s ease,
    transform 0.15s ease;
}
.chat-batch-check.on {
  color: #5dade2;
  transform: scale(1.08);
}
.chat-item.batch-selected {
  background: rgba(93, 173, 226, 0.16);
  box-shadow: inset 0 0 0 1px rgba(93, 173, 226, 0.35);
}
.chat-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
  scrollbar-gutter: stable;
}
.chat-list.batch-mode {
  flex: 1 1 auto;
}
.chat-list-load-more {
  flex-shrink: 0;
  min-height: 38px;
  margin: 4px 8px 10px 0;
  padding: 0 10px;
  border: 1px solid rgba(94, 125, 164, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.52);
  color: #61748d;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}
.chat-list-load-more:hover {
  border-color: rgba(94, 125, 164, 0.36);
  background: #fff;
  color: #34577e;
}
.chat-list-load-more:focus-visible {
  outline: 2px solid #537ab9;
  outline-offset: 2px;
}
.chat-date-label {
  flex-shrink: 0;
  margin: 6px 10px 2px 2px;
  padding: 0 2px;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  color: rgba(236, 240, 241, 0.48);
  text-transform: none;
}
.chat-date-label:first-child {
  margin-top: 0;
}
.res-slide-enter-active,
.res-slide-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease,
    color 0.16s ease;
  overflow: hidden;
}
.res-slide-enter-from,
.res-slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
.res-slide-enter-to,
.res-slide-leave-from {
  opacity: 1;
}
.chat-item {
  position: relative;
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  height: 64px;
  gap: 2px;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  overflow: hidden;
  margin-right: 8px;
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease;
}
.chat-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.chat-item.active {
  background: rgba(27, 79, 114, 0.55);
}
.chat-item.branch-open:not(.active) {
  background: rgba(27, 79, 114, 0.22);
}
/* Sub-chat chips: custom left rail (no native scrollbar arrows). */
.chat-sub-wrap {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex-shrink: 0;
  align-self: stretch;
  width: auto;
  box-sizing: border-box;
  max-height: 84px;
  margin: 0 8px 4px 14px;
  gap: 6px;
}
.chat-sub-rail {
  position: relative;
  flex: 0 0 3px;
  width: 3px;
  border-radius: 2px;
  background: rgba(94, 234, 212, 0.12);
  overflow: hidden;
  align-self: stretch;
}
.chat-sub-rail-thumb {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  border-radius: 2px;
  background: rgba(94, 234, 212, 0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
  will-change: transform;
}
.chat-sub-rail-thumb.show {
  opacity: 1;
}
.chat-sub-scroll {
  flex: 1 1 auto;
  min-width: 0;
  max-height: 84px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.chat-sub-scroll::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
  display: none !important;
  background: transparent;
}
.chat-sub-list {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 4px 5px;
  width: 100%;
  min-height: 26px;
  padding: 2px 2px 2px 0;
  box-sizing: border-box;
}
.chat-sub-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  height: 26px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(236, 240, 241, 0.88);
  transition:
    background 0.14s ease,
    border-color 0.14s ease,
    box-shadow 0.14s ease;
}
.chat-sub-chip:hover,
.chat-sub-chip.menu-open {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.14);
}
.chat-sub-chip.active {
  background: rgba(27, 79, 114, 0.62);
  border-color: rgba(94, 234, 212, 0.28);
  box-shadow: inset 0 0 0 1px rgba(94, 234, 212, 0.12);
}
.chat-sub-chip.running:not(.active) {
  border-color: rgba(94, 234, 212, 0.22);
}
.chat-sub-chip.renaming {
  width: 100%;
  max-width: 100%;
}
.chat-sub-chip-main {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0 6px 0 7px;
  border: 0;
  border-radius: 7px 0 0 7px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.chat-sub-chip.renaming .chat-sub-chip-main {
  flex: 1 1 auto;
  border-radius: 7px;
  padding-right: 8px;
}
.chat-sub-chip-title {
  display: inline-block;
  width: auto;
  max-width: 18em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.74rem;
  font-weight: 550;
  line-height: 1.2;
}
.chat-sub-chip-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  height: 20px;
  margin: 0;
  padding: 0 4px;
  border: 1px solid rgba(94, 234, 212, 0.35);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.25);
  color: #ecf0f1;
  font-size: 0.74rem;
  font-weight: 550;
  outline: none;
}
.chat-sub-chip-status {
  flex-shrink: 0;
  display: inline-grid;
  place-items: center;
  width: 12px;
  height: 12px;
  font-size: 0.62rem;
  opacity: 0.9;
}
.chat-sub-chip-status.running {
  color: #5dade2;
}
.chat-sub-chip-status.ask {
  color: #f5b041;
}
.chat-sub-chip-status.perm {
  color: #58d68d;
}
.chat-sub-chip-status.error {
  color: #f1948a;
}
.chat-sub-chip-status.stopped {
  color: rgba(236, 240, 241, 0.55);
}
.chat-sub-chip-status.key {
  color: #f7dc6f;
}
.chat-sub-chip-ask {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5b041;
  box-shadow: 0 0 0 2px rgba(245, 176, 65, 0.2);
}
.chat-sub-chip-more {
  flex-shrink: 0;
  width: 22px;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 0 7px 7px 0;
  background: transparent;
  color: rgba(236, 240, 241, 0.55);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  font-size: 0.68rem;
  opacity: 0.55;
  transition:
    opacity 0.12s ease,
    color 0.12s ease,
    background 0.12s ease;
}
.chat-sub-chip:hover .chat-sub-chip-more,
.chat-sub-chip.menu-open .chat-sub-chip-more,
.chat-sub-chip.renaming .chat-sub-chip-more {
  opacity: 1;
}
.chat-sub-chip.renaming .chat-sub-chip-more {
  display: none;
}
.chat-sub-chip-more:hover,
.chat-sub-chip.menu-open .chat-sub-chip-more {
  background: rgba(255, 255, 255, 0.08);
  color: #ecf0f1;
}
.chat-item-stats {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  height: 16px;
}
.chat-stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 16px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  line-height: 1;
  color: rgba(214, 225, 234, 0.82);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.chat-stat-sub {
  color: rgba(167, 243, 208, 0.95);
  background: rgba(15, 118, 110, 0.24);
  border-color: rgba(45, 212, 191, 0.22);
}
.chat-stat .app-icon {
  font-size: 0.58rem;
  opacity: 0.92;
}
.chat-stat-num {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}
.chat-item-track {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: stretch;
  gap: 2px;
  width: 100%;
  height: 100%;
  min-width: 0;
  border-radius: 8px;
  background: transparent;
  will-change: transform;
  transition: transform 0.2s ease;
}
.chat-item.swiping .chat-item-track {
  transition: none;
}
.chat-item-main {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  text-align: left;
  border: 0;
  border-radius: 8px;
  padding: 8px 8px 8px 10px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.chat-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.chat-pin-icon {
  flex-shrink: 0;
  font-size: 0.68rem;
  color: rgba(241, 196, 15, 0.9);
  margin-right: 2px;
  transform: rotate(45deg);
}
.chat-item-trail {
  position: relative;
  flex: 0 0 auto;
  align-self: center;
  min-width: 28px;
  height: 28px;
  margin-right: 6px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.chat-item-trail-face {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  max-width: 72px;
  height: 100%;
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.chat-item-trail-face .chat-status-icon {
  margin: 0;
}
.chat-item-trail-more {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateX(8px);
  pointer-events: none;
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.chat-item:hover .chat-item-trail-face,
.chat-item:focus-within .chat-item-trail-face,
.chat-item.menu-open .chat-item-trail-face {
  opacity: 0;
  transform: translateX(-6px);
  pointer-events: none;
}
.chat-item:hover .chat-item-trail-more,
.chat-item:focus-within .chat-item-trail-more,
.chat-item.menu-open .chat-item-trail-more,
.chat-item.renaming .chat-item-trail-more {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}
.chat-more-btn {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(236, 240, 241, 0.7);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  transition: background 0.12s ease, color 0.12s ease;
}
.chat-more-btn:hover,
.chat-item.menu-open .chat-more-btn {
  background: rgba(255, 255, 255, 0.1);
  color: #ecf0f1;
}
:global(.chat-more-menu) {
  border-radius: 10px !important;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28) !important;
}
.chat-more-panel {
  min-width: 140px;
  padding: 6px;
  background: #1c2833;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}
.chat-more-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(236, 240, 241, 0.92);
  font-size: 0.86rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
}
.chat-more-item:hover {
  background: rgba(255, 255, 255, 0.08);
}
.chat-more-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.chat-more-item:disabled:hover {
  background: transparent;
}
.chat-more-item.danger {
  color: #f1948a;
}
.chat-more-item.danger:hover {
  background: rgba(231, 76, 60, 0.14);
}
.chat-swipe-del {
  display: none;
}
.chat-item-title {
  font-size: 0.9rem;
  line-height: 22px;
  height: 22px;
  min-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 6px;
}
.chat-item-title-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-item-title-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 22px;
  margin: 0;
  padding: 0 6px;
  border: 1px solid rgba(125, 211, 252, 0.7);
  border-radius: 6px;
  background: #f4f8fb;
  color: #1b2631;
  caret-color: #1b4f72;
  font: inherit;
  font-size: 0.9rem;
  line-height: 20px;
  outline: none;
}
.chat-item-title-input:focus {
  border-color: #5dade2;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.28);
}
.chat-item-title-input::selection {
  background: #1b4f72;
  color: #ffffff;
}
.chat-item-title-input::-moz-selection {
  background: #1b4f72;
  color: #ffffff;
}
.chat-item-trail.mobile-more-only {
  width: 28px;
  max-width: 28px;
}
.chat-item-trail.mobile-more-only .chat-item-trail-more {
  opacity: 1;
  pointer-events: auto;
  transform: none;
}
.chat-item-trail.mobile-more-only .chat-more-btn {
  opacity: 0.72;
}
.chat-status-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  padding: 0;
  cursor: pointer;
  line-height: 1;
}
.chat-status-icon.running {
  background: rgba(61, 214, 140, 0.16);
  color: #3dd68c;
}
.chat-status-icon.ask {
  background: rgba(230, 126, 34, 0.16);
  color: #f0b429;
}
.chat-status-icon.perm {
  background: rgba(52, 152, 219, 0.16);
  color: #5dade2;
}
.chat-status-icon.error {
  background: rgba(231, 76, 60, 0.18);
  color: #ff8a80;
}
.chat-status-icon.stopped {
  background: rgba(120, 136, 152, 0.16);
  color: #8a97a5;
}
.chat-status-icon.key {
  background: rgba(241, 196, 15, 0.16);
  color: #f4d03f;
}
.ask-pending-badge {
  color: #b9770e !important;
  background: rgba(230, 126, 34, 0.14) !important;
  flex-shrink: 1;
  min-width: 0;
}
.chat-item-meta {
  margin-top: 4px;
  height: 16px;
  min-height: 16px;
  font-size: 0.7rem;
  line-height: 16px;
  opacity: 0.65;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}
.chat-item-time {
  flex: 0 0 auto;
  white-space: nowrap;
}
.chat-item-meta-end {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.badge {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 0 6px;
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-dock {
  flex: 0 1 auto;
  max-height: min(48vh, 440px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.sidebar-foot {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 8px;
  padding-right: 12px;
  margin-top: 4px;
  flex-shrink: 0;
}
.sidebar-foot-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sidebar-foot-end {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.sidebar-settings-btn {
  margin-left: 0;
}
.sidebar-icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: transparent;
  color: rgba(236, 240, 241, 0.88);
  font-size: 0.95rem;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease;
}
.sidebar-icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.sidebar-icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.sidebar-icon-btn:disabled:hover {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(236, 240, 241, 0.88);
}
:global(.sidebar-more-menu) {
  border-radius: 10px !important;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28) !important;
}
.sidebar-more-panel {
  min-width: 168px;
  padding: 6px;
  background: #1c2833;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}
.sidebar-more-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(236, 240, 241, 0.92);
  font-size: 0.88rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
}
.sidebar-more-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}
.sidebar-more-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.sidebar-more-item.danger {
  color: #f1948a;
}
.sidebar-more-item.danger:hover:not(:disabled) {
  background: rgba(231, 76, 60, 0.14);
}
.main {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  overflow: hidden;
  background: linear-gradient(180deg, #f7f9fb 0%, #eef2f5 100%);
}
.win-drag-main {
  position: absolute;
  top: 0;
  left: 0;
  right: 138px;
  height: 36px;
  z-index: 4;
  -webkit-app-region: drag;
}
.win-chrome-host {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 8;
  -webkit-app-region: no-drag;
}
.shell.frameless .mobile-topbar {
  padding-right: 150px;
}
.main-top {
  padding: 16px 20px 8px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  box-sizing: border-box;
}
.main-top-text {
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
.main-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
  color: #1b2631;
  letter-spacing: -0.01em;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  word-break: normal;
}
.main-title.is-sub {
  margin-top: 6px;
}
.subchat-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
}
.subchat-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  border: 1px solid rgba(15, 23, 42, 0.12);
  background: #fff;
  color: #334155;
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 0.78rem;
  cursor: pointer;
}
.subchat-back:hover:not(:disabled) {
  border-color: rgba(15, 23, 42, 0.28);
}
.subchat-back:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.subchat-banner-label {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 600;
  color: #0f766e;
  background: rgba(15, 118, 110, 0.1);
  border-radius: 999px;
  padding: 2px 8px;
}
.subchat-spawn-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 10px;
  border-top: 1px solid rgba(15, 23, 42, 0.06);
  min-width: 0;
}
.subchat-spawn-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.subchat-spawn-status {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 600;
  border-radius: 999px;
  padding: 2px 8px;
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
}
.subchat-spawn-status.done {
  background: rgba(22, 163, 74, 0.12);
  color: #15803d;
}
.subchat-spawn-status.failed,
.subchat-spawn-status.cancelled {
  background: rgba(220, 38, 38, 0.1);
  color: #b91c1c;
}
.subchat-spawn-status.deleted {
  background: rgba(100, 116, 139, 0.14);
  color: #64748b;
}
.subchat-spawn-status.running {
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
}
.subchat-spawn-goal {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 0.8rem;
  color: #475569;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}
.subchat-spawn-goal.link {
  color: #1b4f72;
  cursor: pointer;
}
.subchat-spawn-goal.link:hover {
  text-decoration: underline;
  color: #0f3a56;
}
.subchat-spawn-goal.deleted,
.subchat-spawn-goal:disabled {
  color: #94a3b8;
  text-decoration: line-through;
  cursor: default;
  pointer-events: none;
}
.agent-live {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 1;
  min-width: 0;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(27, 79, 114, 0.08);
  border: 1px solid rgba(27, 79, 114, 0.18);
  color: #1b4f72;
  font-size: 0.75rem;
  font-weight: 600;
  max-width: min(220px, 32vw);
}
.agent-live-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-elapsed {
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}
.pulse-ring {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1b4f72;
  position: relative;
  flex-shrink: 0;
}
.pulse-ring::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid rgba(27, 79, 114, 0.35);
  animation: ring 1.2s ease-out infinite;
}
@keyframes ring {
  to {
    transform: scale(1.6);
    opacity: 0;
  }
}
.messages-wrap {
  position: relative;
  min-height: 0;
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.messages {
  overflow-x: hidden;
  overflow-y: auto;
  /* 右侧多留空，滚动条贴主区边缘，与气泡内容拉开 */
  padding: 8px clamp(18px, 3vw, 28px) 16px clamp(12px, 2.5vw, 20px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-height: 0;
  min-width: 0;
  flex: 1;
  width: 100%;
  box-sizing: border-box;
  scrollbar-gutter: stable;
}
.msg-empty {
  margin: auto 0;
  width: min(720px, 100%);
  max-width: 100%;
  padding: 24px 0 48px;
  color: #5d6d7e;
  box-sizing: border-box;
}
.msg-empty-title {
  font-size: 1.05rem;
  font-weight: 650;
  color: #1b2834;
  margin-bottom: 6px;
  padding: 0 8px;
}
.msg-empty-desc {
  margin: 0 0 18px;
  padding: 0 8px;
  font-size: 0.85rem;
  line-height: 1.5;
  color: #7f8c8d;
}
.suggest-marquee {
  display: flex;
  flex-direction: column;
  gap: 10px;
  mask-image: linear-gradient(
    90deg,
    transparent 0%,
    #000 8%,
    #000 92%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    90deg,
    transparent 0%,
    #000 8%,
    #000 92%,
    transparent 100%
  );
}
.suggest-rail {
  overflow: hidden;
  width: 100%;
}
.suggest-track {
  display: flex;
  width: max-content;
  gap: 8px;
  animation: suggest-scroll 42s linear infinite;
  will-change: transform;
}
.suggest-rail.reverse .suggest-track {
  animation-name: suggest-scroll-reverse;
  animation-duration: 48s;
}
.suggest-rail:hover .suggest-track,
.suggest-rail:focus-within .suggest-track {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  .suggest-track {
    animation: none !important;
    flex-wrap: wrap;
    width: 100%;
    max-width: 100%;
    justify-content: flex-start;
  }
  .suggest-chip[aria-hidden='true'] {
    display: none;
  }
}
@keyframes suggest-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}
@keyframes suggest-scroll-reverse {
  from {
    transform: translateX(-50%);
  }
  to {
    transform: translateX(0);
  }
}
.suggest-chip {
  flex: 0 0 auto;
  border: 1px solid #d5dde5;
  background: #fff;
  color: #1b4f72;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 0.8rem;
  line-height: 1.3;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
}
.suggest-chip:hover {
  background: #eaf3fa;
  border-color: #9fc0d8;
  transform: translateY(-1px);
}
.suggest-chip--action {
  border-color: #b7c9a8;
  color: #2d5a27;
  background: #f4f8f1;
}
.suggest-chip--action:hover {
  background: #e7f0e2;
  border-color: #8fad7e;
}
.followup-block {
  width: min(720px, 100%);
  margin: 8px auto 4px;
  padding: 12px 8px 8px;
  box-sizing: border-box;
}
.retry-bar {
  width: min(720px, 100%);
  margin: 12px auto 8px;
  padding: 4px 8px;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: center;
}
.retry-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid #d5dee7;
  background: #fff;
  color: #1b4f72;
  border-radius: 999px;
  padding: 6px 14px;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
  cursor: pointer;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease,
    opacity 0.12s ease;
}
.retry-btn:hover:not(:disabled) {
  background: #f4f8fb;
  border-color: #9bb6c9;
}
.retry-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.followup-label {
  margin-bottom: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  color: #8a97a5;
  letter-spacing: 0.02em;
}
.followup-store {
  margin-bottom: 12px;
}
.followup-store .catalog-item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.followup-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.followup-chips .suggest-chip {
  white-space: normal;
  text-align: left;
  max-width: 100%;
  line-height: 1.35;
}
.msg {
  width: min(720px, 100%);
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  animation: fade-in 0.2s ease;
}
.inchat-decision {
  width: min(720px, 100%);
  max-width: 100%;
  min-width: 0;
  align-self: center;
  box-sizing: border-box;
}
.pending-ask-card {
  display: block;
  width: min(720px, 100%);
  margin: 4px 0 8px;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.pending-ask-card .msg-main {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #b7d0e2;
  background: linear-gradient(180deg, #f4f9fc 0%, #eef5fa 100%);
  box-shadow: 0 1px 0 rgba(27, 79, 114, 0.06);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    transform 0.15s ease;
}
.pending-ask-card:hover .msg-main,
.pending-ask-card:focus-visible .msg-main {
  border-color: #1b4f72;
  background: linear-gradient(180deg, #eef6fb 0%, #e4f0f8 100%);
  outline: none;
}
.pending-ask-card:focus-visible {
  outline: none;
}
.pending-ask-card:active .msg-main {
  transform: translateY(1px);
}
.msg-avatar.pending-ask {
  background: #1b4f72;
  color: #fff;
}
.pending-ask-step {
  margin-left: 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #1b4f72;
  opacity: 0.85;
}
.pending-ask-question {
  margin-top: 4px;
  font-size: 0.95rem;
  font-weight: 650;
  color: #15202b;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pending-ask-timeout-block {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.pending-ask-timeout {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: #b9770e;
}
.pending-ask-cta {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 650;
  color: #1b4f72;
}
.pending-ask-dock {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(720px, 100%);
  max-width: 100%;
  box-sizing: border-box;
  margin: 0 0 8px;
  padding: 6px 8px 6px 10px;
  border-radius: 10px;
  border: 1px solid #c5d8e6;
  background: #f3f8fb;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  min-height: 0;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.pending-ask-dock:hover,
.pending-ask-dock:focus-visible {
  border-color: #1b4f72;
  background: #e8f2fa;
  outline: none;
}
.pending-ask-dock-icon {
  flex-shrink: 0;
  color: #1b4f72;
  font-size: 0.88rem;
}
.pending-ask-dock-body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.pending-ask-dock-label {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #1b4f72;
  white-space: nowrap;
}
.pending-ask-dock-q {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  line-height: 1.25;
  color: #2c3e50;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pending-ask-dock-timeout {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 650;
  color: #b9770e;
  white-space: nowrap;
}
.pending-ask-dock-action {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 6px;
  background: #1b4f72;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.4;
}
.pending-ask-dock-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: #dce7ef;
  pointer-events: none;
}
.pending-ask-dock-bar-fill {
  display: block;
  height: 100%;
  background: #5d8aa8;
  transition: width 0.45s linear, background-color 0.2s ease;
}
.pending-ask-dock-bar.urgent .pending-ask-dock-bar-fill {
  background: #c0392b;
}
.log-kind-chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.75rem;
  /* 与日志正文首行行盒等高，保证标签与内容垂直对齐 */
  height: calc(0.82rem * 1.45);
  margin-top: 0;
  padding: 0 8px;
  box-sizing: border-box;
  border-radius: 6px;
  border: 1px solid #d7e0e8;
  background: #f0f4f8;
  color: #5a6b7a;
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  line-height: 1;
}
.msg.log.tone-op .log-kind-chip {
  border-color: #c5d8e8;
  background: #e8f2fa;
  color: #1a5678;
}
.msg.log.tone-choice .log-kind-chip {
  border-color: #c5dfcb;
  background: #eaf6ee;
  color: #1f6b3d;
}
.msg.log.tone-perm .log-kind-chip {
  border-color: #d5cce6;
  background: #f2edf8;
  color: #5a3f82;
}
.msg.log.tone-error .log-kind-chip {
  border-color: #e8c4be;
  background: #f9ecea;
  color: #a03d3a;
}
.msg.log.tone-system .log-kind-chip,
.msg.log.tone-info .log-kind-chip {
  border-color: #d5dde5;
  background: #eef1f4;
  color: #556575;
}
.log-card {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid #e1e7ee;
  border-radius: 10px;
  background: #f7f9fb;
  overflow: hidden;
  box-shadow: inset 3px 0 0 #c5d4e0;
}
.msg.log.tone-op .log-card {
  box-shadow: inset 3px 0 0 #7eafcf;
}
.msg.log.tone-choice .log-card {
  box-shadow: inset 3px 0 0 #6faf84;
}
.msg.log.tone-perm .log-card {
  box-shadow: inset 3px 0 0 #9b84c0;
}
.msg.log.tone-error .log-card {
  border-color: #ecd0cc;
  background: #fcf7f6;
  box-shadow: inset 3px 0 0 #d17a72;
}
.msg.log.tone-system .log-card,
.msg.log.tone-info .log-card {
  box-shadow: inset 3px 0 0 #9aa7b4;
}
.log-card-head {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px 9px 11px;
  border: 0;
  background: transparent;
  cursor: default;
  text-align: left;
  color: inherit;
  font: inherit;
  box-sizing: border-box;
}
.log-card.expandable .log-card-head {
  cursor: pointer;
}
.log-card:not(.expandable) .log-card-head:hover {
  background: transparent;
}
.log-card.expandable .log-card-head:hover {
  background: rgba(27, 79, 114, 0.04);
}
.log-card-text {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: #2f3e4c;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.log-card-text.clamped {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-card-chevron {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: calc(0.82rem * 1.45);
  font-size: 0.7rem;
  color: #8a97a5;
  text-align: center;
}
.msg.log {
  user-select: text;
  -webkit-user-select: text;
}
.msg.log .msg-role,
.msg.log .log-kind-chip,
.msg.log .log-card-chevron {
  user-select: none;
  -webkit-user-select: none;
}
.msg-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  min-width: 0;
}
.msg-avatar {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 0.68rem;
  font-weight: 700;
  color: #fff;
  background: #5d6d7e;
}
.msg-avatar.assistant {
  background: transparent;
  box-shadow: 0 0 0 1px rgba(27, 79, 114, 0.12);
}
.msg-avatar.assistant img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.msg-avatar.user {
  background: #1b4f72;
}
.msg-avatar.tool {
  background: #3d7ea6;
  font-size: 0.75rem;
}
.msg-avatar.tool.automation {
  background: #2f6b5d;
}
.msg-avatar.tool.shell {
  background: #4a5568;
}
.msg-avatar.tool.files {
  background: #8a6d3b;
}
.msg-avatar.tool.settings {
  background: #5c6b7a;
}
.msg-avatar.tool.interact {
  background: #6b5b95;
}
.msg-avatar.tool.plugin {
  background: #0f766e;
}
.msg-avatar.log {
  background: #7f8c9a;
  font-size: 0.75rem;
}
.msg-avatar.run {
  background: #3d7ea6;
  font-size: 0.72rem;
}
.msg.run .msg-role {
  margin-bottom: 0.28rem;
}
.msg-main {
  flex: 1;
  min-width: 0;
}
.msg-task-declarations{display:flex;align-items:center;margin:0 0 8px;font-size:11px;line-height:1.5;color:var(--navora-muted)}
.msg-role {
  font-size: 0.72rem;
  font-weight: 600;
  color: #5d6d7e;
  margin-bottom: 4px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.msg-elapsed {
  font-size: 0.72rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: #8a97a3;
  line-height: 1.2;
  letter-spacing: 0.01em;
  user-select: none;
}
.msg-time {
  font-weight: 400;
  opacity: 0;
  transition: opacity 0.15s ease;
  font-size: 0.68rem;
}
.msg:hover .msg-time {
  opacity: 0.7;
}
.msg-refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
  max-width: 100%;
}
.msg-body {
  line-height: 1.5;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e1e7ee;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow-x: auto;
  white-space: pre-wrap;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.msg-body.md {
  white-space: normal;
}
.msg-body.md :deep(*) {
  max-width: 100%;
}
.msg-body.md :deep(p) {
  margin: 0 0 0.65em;
}
.msg-body.md :deep(p:last-child) {
  margin-bottom: 0;
}
.msg-body.md :deep(ul),
.msg-body.md :deep(ol) {
  margin: 0.4em 0 0.65em;
  padding-left: 1.35em;
}
.msg-body.md :deep(li) {
  margin: 0.2em 0;
}
.msg-body.md :deep(h1),
.msg-body.md :deep(h2),
.msg-body.md :deep(h3),
.msg-body.md :deep(h4) {
  margin: 0.75em 0 0.4em;
  font-weight: 650;
  line-height: 1.3;
  color: #1b2834;
  overflow-wrap: anywhere;
}
.msg-body.md :deep(h1) {
  font-size: 1.15rem;
}
.msg-body.md :deep(h2) {
  font-size: 1.05rem;
}
.msg-body.md :deep(h3),
.msg-body.md :deep(h4) {
  font-size: 0.95rem;
}
.msg-body.md :deep(code) {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.84em;
  background: rgba(27, 79, 114, 0.08);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.msg-body.md :deep(pre) {
  margin: 0.5em 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #15202b;
  color: #ecf0f1;
  overflow-x: auto;
  overflow-y: auto;
  max-width: 100%;
  max-height: min(360px, 45vh);
  font-size: 0.8rem;
  line-height: 1.45;
  box-sizing: border-box;
}
.msg-body.md :deep(pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: inherit;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
}
.msg-body.md :deep(blockquote) {
  margin: 0.5em 0;
  padding: 0.25em 0 0.25em 0.85em;
  border-left: 3px solid #9fc0d8;
  color: #5d6d7e;
}
.msg-body.md :deep(a) {
  color: #1b4f72;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}
.msg-body.md :deep(table) {
  border-collapse: collapse;
  width: max-content;
  max-width: 100%;
  display: block;
  overflow-x: auto;
  margin: 0.5em 0;
  font-size: 0.85rem;
}
.msg-body.md :deep(th),
.msg-body.md :deep(td) {
  border: 1px solid #d5dde5;
  padding: 6px 8px;
  text-align: left;
}
.msg-body.md :deep(th) {
  background: #f0f4f8;
  font-weight: 600;
}
.msg-body.md :deep(hr) {
  border: 0;
  border-top: 1px solid #d5dde5;
  margin: 0.85em 0;
}
.read-pages-bar {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  margin: 0 0 8px;
  padding: 6px 10px 6px 12px;
  border: 1px solid #d5e0ea;
  border-radius: 999px;
  background: #f3f7fa;
  color: #1b4f72;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
}
.read-pages-bar:hover {
  background: #e7f0f7;
  border-color: #b7c9d8;
}
.read-pages-bar.active {
  background: #ddebf5;
  border-color: #1b4f72;
}
.read-pages-text {
  white-space: nowrap;
}
.read-pages-icons {
  display: inline-flex;
  align-items: center;
}
.read-pages-icon {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1.5px solid #fff;
  background: #fff;
  object-fit: contain;
  margin-left: -6px;
  box-shadow: 0 0 0 1px rgba(27, 79, 114, 0.12);
}
.read-pages-icon:first-child {
  margin-left: 0;
}
.read-pages-chevron {
  font-size: 0.7rem;
  opacity: 0.65;
}
.read-pages-dialog {
  display: flex;
  flex-direction: column;
  max-height: min(72vh, 640px);
  background: #f7fafc;
  border-radius: 14px;
  overflow: hidden;
}
.read-pages-dialog-head {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid #e1e8ef;
  background: #fff;
}
.read-pages-dialog-head h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #15202b;
}
.read-pages-dialog-head p {
  margin: 4px 0 0;
  font-size: 0.78rem;
  color: #5d6d7e;
}
.read-pages-dialog-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #5d6d7e;
  cursor: pointer;
}
.read-pages-dialog-close:hover {
  background: #eef2f5;
  color: #15202b;
}
.read-pages-dialog-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: grid;
  gap: 10px;
  align-content: start;
}
.read-page-card {
  display: grid;
  gap: 6px;
  text-align: left;
  padding: 12px;
  border: 1px solid #d9e2ea;
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  color: inherit;
}
.read-page-card:hover {
  border-color: #1b4f72;
  box-shadow: 0 6px 16px rgba(21, 32, 43, 0.06);
}
.read-page-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.read-page-card-icon {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  object-fit: contain;
  background: #f4f7fa;
  flex-shrink: 0;
}
.read-page-site {
  font-size: 0.75rem;
  font-weight: 650;
  color: #1b4f72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.read-page-title {
  font-size: 0.88rem;
  font-weight: 650;
  color: #15202b;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.read-page-snippet {
  font-size: 0.78rem;
  color: #5d6d7e;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tool-media {
  margin: 0 10px 10px;
  border: 1px solid #d5dde5;
  border-radius: 10px;
  overflow: hidden;
  background: #0f1720;
  cursor: zoom-in;
}
.tool-media img {
  display: block;
  width: 100%;
  max-height: 280px;
  object-fit: contain;
  background: #0f1720;
}
.tool-media-path {
  display: block;
  padding: 6px 10px;
  font-size: 0.72rem;
  color: #5d6d7e;
  background: #f7fafc;
  border-top: 1px solid #e4ebf1;
  font-family: ui-monospace, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-lightbox {
  position: relative;
  width: 100%;
  height: min(80vh, 900px);
  min-height: 240px;
  box-sizing: border-box;
  border-radius: 12px;
  background: rgba(10, 16, 22, 0.88);
  display: grid;
  place-items: center;
  padding: 28px 20px 48px;
  cursor: zoom-out;
}
.media-lightbox img {
  max-width: 100%;
  max-height: calc(min(80vh, 900px) - 96px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  cursor: default;
}
.media-lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  cursor: pointer;
}
.media-lightbox-close:hover {
  background: rgba(255, 255, 255, 0.24);
}
.media-lightbox-cap {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  max-width: 90%;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.82rem;
  text-align: center;
}
.msg.user :deep(.msg-body) {
  background: #e8f1f8;
  border-color: #c5d8e8;
}
.msg.user :deep(.msg-media-item span) {
  background: #eef5fa;
}
.msg.log .msg-body {
  background: #f8f5e6;
  border-color: #e8dfb8;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.85rem;
}
.msg.tool .msg-body.tool {
  background: #f3f6f9;
  border-color: #d5dde5;
  padding: 8px 10px;
}
.tool-name {
  font-size: 0.72rem;
  font-weight: 700;
  color: #1b4f72;
  margin-bottom: 4px;
}
.tool-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.75rem;
  max-height: 160px;
  overflow: auto;
}
.tool-kind-chip {
  flex: 0 0 auto;
  width: max-content;
  max-width: 40%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: calc(0.78rem * 1.45);
  padding: 0 7px;
  box-sizing: border-box;
  border-radius: 6px;
  border: 1px solid #d0dce6;
  background: #eef4f8;
  color: #3d5a6e;
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  line-height: 1;
  white-space: nowrap;
}
.tool-kind-chip.automation {
  border-color: #b9d8cf;
  background: #e7f4ef;
  color: #1f5c4c;
}
.tool-kind-chip.shell {
  border-color: #c8ced6;
  background: #eef0f3;
  color: #3a4553;
}
.tool-kind-chip.files {
  border-color: #e0d2b4;
  background: #f7f1e4;
  color: #6b5428;
}
.tool-kind-chip.settings {
  border-color: #c9d3dc;
  background: #eef2f5;
  color: #4a5a68;
}
.tool-kind-chip.interact {
  border-color: #d4cce6;
  background: #f3eff8;
  color: #5a4580;
}
.tool-kind-chip.plugin {
  border-color: #99d5cf;
  background: #e6f7f4;
  color: #0f766e;
}
.tool-kind-chip.tool {
  border-color: #c5d8e8;
  background: #e8f2fa;
  color: #1a5678;
}
.tool-card {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid #d5dde5;
  border-radius: 10px;
  background: #f7fafc;
  overflow: hidden;
}
.tool-card.tool-running,
.msg.tool-running .tool-card {
  border-color: #9fc0d8;
  background: linear-gradient(90deg, #f0f7fc, #f7fafc 40%, #eef5fa);
  background-size: 200% 100%;
  animation: tool-shimmer 1.6s linear infinite;
}
@keyframes tool-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
.msg.tool-error .tool-card {
  border-color: #e8b4ae;
  background: #fdf6f5;
}
.msg.tool-aborted .tool-card,
.tool-card.tool-aborted {
  border-color: #d7dde3;
  background: #f4f6f8;
}
.tool-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
  color: inherit;
}
.tool-dl-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 10px 8px;
}
.tool-dl-progress.thinking-dl {
  padding: 6px 0 2px;
}
.tool-dl-bar {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: rgba(27, 79, 114, 0.14);
  overflow: hidden;
}
.tool-dl-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #3a7ca5, #1b4f72);
  transition: width 0.2s ease;
}
.tool-dl-bar.indeterminate .tool-dl-fill {
  width: 40%;
  animation: tool-dl-indeterminate 1.1s ease-in-out infinite;
}
.tool-dl-label {
  font-size: 0.72rem;
  color: #5a6a7a;
  line-height: 1.3;
}
@keyframes tool-dl-indeterminate {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}
.tool-status {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
  background: #d5e8d7;
  color: #1e6b45;
}
.tool-status.running {
  background: #d6e6f2;
  color: #1b4f72;
}
.tool-status.error {
  background: #f5d4cf;
  color: #c0392b;
}
.tool-status.aborted {
  background: #e2e6ea;
  color: #5d6d7e;
}
.spin {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(27, 79, 114, 0.25);
  border-top-color: #1b4f72;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.tool-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: #1b2834;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-raw {
  font-size: 0.68rem;
  color: #8a97a5;
  font-family: ui-monospace, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 48%;
}
.tool-head-spacer {
  flex: 1 1 auto;
  min-width: 4px;
}
.tool-chevron {
  color: #8a97a5;
  font-size: 0.7rem;
  width: 14px;
  flex: 0 0 auto;
  display: inline-grid;
  place-items: center;
}
.tool-detail {
  border-top: 1px solid #e4ebf1;
  padding: 8px 10px 10px;
  display: grid;
  gap: 8px;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.tool-sec-label {
  font-size: 0.68rem;
  font-weight: 700;
  color: #5d6d7e;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tool-section pre {
  margin: 0;
  padding: 8px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #e8eef4;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.72rem;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-width: 100%;
  max-height: min(180px, 30vh);
  overflow: auto;
  box-sizing: border-box;
}
.thinking-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: min(720px, 100%);
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  animation: fade-in 0.25s ease;
}
@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.thinking-avatar {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(27, 79, 114, 0.12);
}
.thinking-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thinking-bubble {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #dbe4ee;
  box-shadow: 0 1px 0 rgba(27, 79, 114, 0.04);
}
.thinking-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #1b4f72;
}
.thinking-reason {
  margin-top: 6px;
}
.thinking-reason-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: #8a97a5;
  text-align: left;
}
.thinking-reason-toggle:hover {
  color: #6a7a8a;
}
.thinking-reason-chevron {
  font-size: 0.62rem;
  opacity: 0.85;
}
.thinking-reason-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.75rem;
  font-weight: 500;
}
.thinking-reason-round {
  font-weight: 400;
  color: #a0abb6;
  font-size: 0.7rem;
}
.thinking-reason-body {
  margin: 6px 0 0;
  padding: 0 0 0 14px;
  max-height: min(220px, 32vh);
  overflow: auto;
  border-left: 1px solid rgba(138, 151, 165, 0.28);
  font-size: 0.74rem;
  line-height: 1.55;
  color: #8a97a5;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-reasoning {
  margin: 0 0 6px;
}
.msg-reasoning-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  color: #8a97a5;
  text-align: left;
}
.msg-reasoning-toggle:hover {
  color: #6a7a8a;
}
.msg-reasoning-chevron {
  font-size: 0.62rem;
  opacity: 0.85;
}
.msg-reasoning-body {
  margin: 6px 0 0;
  padding: 0 0 0 14px;
  max-height: min(280px, 40vh);
  overflow: auto;
  border-left: 1px solid rgba(138, 151, 165, 0.28);
  font-size: 0.74rem;
  line-height: 1.55;
  color: #8a97a5;
  white-space: pre-wrap;
  word-break: break-word;
}
.thinking-dots {
  display: flex;
  gap: 5px;
  margin-top: 8px;
}
.thinking-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1b4f72;
  opacity: 0.35;
  animation: bounce 1.2s ease-in-out infinite;
}
.thinking-dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.thinking-dots span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.3;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
.msg-body.shimmer {
  background: linear-gradient(90deg, #e8f1f8, #f5f9fc, #e8f1f8);
  background-size: 200% 100%;
  animation: tool-shimmer 2s linear infinite;
}
.composer {
  padding: 10px clamp(12px, 2.5vw, 20px) 14px;
  border-top: 1px solid #d5dde5;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  display: grid;
  gap: 8px;
  justify-items: center;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  transition: box-shadow 0.15s ease, background 0.15s ease;
}
.composer.running {
  border-top-color: #c5d8e8;
}
.composer.drop-active {
  background: #eaf3fa;
  box-shadow: inset 0 0 0 2px #1b4f72;
}
.composer-box {
  position: relative;
  border: 1px solid #d5dde5;
  border-radius: 12px;
  background: #fff;
  padding: 4px 6px 6px;
  width: min(720px, 100%);
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.composer-box:focus-within {
  border-color: #1b4f72;
  box-shadow: 0 0 0 3px rgba(27, 79, 114, 0.12);
}
.composer-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 4px;
  padding: 6px 2px 2px 6px;
}
.composer-limit {
  padding: 0 10px 2px;
  font-size: 0.72rem;
  color: #95a5a6;
  text-align: right;
  user-select: none;
}
.composer-limit.danger {
  color: #c0392b;
  font-weight: 600;
}
.composer-input {
  min-width: 0;
}
.composer-input :deep(.v-field) {
  box-shadow: none !important;
}
/* Vuetify textarea uses a top fade mask (for floating labels); it clips the first line here. */
.composer-input :deep(.v-field__input) {
  -webkit-mask-image: none !important;
  mask-image: none !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
  padding-inline: 6px !important;
  align-items: flex-start;
}
.composer-input :deep(textarea) {
  margin: 0;
  padding: 0 !important;
  font-size: 0.92rem;
  line-height: 1.45;
  max-height: none;
  overflow-y: auto !important;
  user-select: text;
  -webkit-user-select: text;
}
.composer-input :deep(textarea) {max-height:min(calc(1.45em * 10),40dvh);}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  width: min(720px, 100%);
  max-width: 100%;
  box-sizing: border-box;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 240px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  border: 1px solid transparent;
  background: #e8eef5;
  color: #1b4f72;
}
.chip.session {
  background: #e8eef5;
  border-color: #c5d4e4;
}
.chip.window {
  background: #eaf6ef;
  border-color: #c5e0d0;
  color: #1e6b45;
}
.chip.editable .chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-x {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.7rem;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.7;
  display: inline-grid;
  place-items: center;
}
.chip-x:hover {
  opacity: 1;
}
.chip-clear {
  border: 0;
  background: transparent;
  color: #7f8c8d;
  font-size: 0.72rem;
  cursor: pointer;
  padding: 2px 6px;
}
.chip-clear:hover {
  color: #1b4f72;
}
.composer-actions {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
  padding: 2px 4px 2px;
  min-height: 36px;
}
.composer-actions-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.composer-actions-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.composer-perm-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: #5d6d7e;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 4px 6px;
  border-radius: 8px;
  cursor: pointer;
  line-height: 1.2;
  max-width: min(280px, 46vw);
}
.composer-perm-btn > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-perm-btn:hover {
  color: #1b4f72;
  background: #eaf3fa;
}
.usage-ring-btn {
  width: 32px;
  height: 32px;
  border: 0;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  display: inline-grid;
  place-items: center;
}
.usage-ring-btn:hover {
  background: #eaf3fa;
}
.usage-ring {
  width: 26px;
  height: 26px;
}
.usage-ring-track {
  stroke: #d5dde5;
  stroke-width: 3.5;
}
.usage-ring-value {
  stroke-width: 3.5;
  stroke-linecap: round;
  transition: stroke-dasharray 0.2s ease, stroke 0.2s ease;
}
.usage-ring-value.cool {
  stroke: #1b4f72;
}
.usage-ring-value.warm {
  stroke: #c47f17;
}
.usage-ring-value.hot {
  stroke: #c0392b;
}
.composer-send {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: #1b4f72;
  color: #fff;
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  font-size: 0.9rem;
  transition: background 0.15s ease, opacity 0.15s ease, transform 0.12s ease;
}
.composer-send:hover:not(:disabled) {
  background: #163f5c;
}
.composer-send:active:not(:disabled) {
  transform: scale(0.96);
}
.composer-send:disabled {
  opacity: 0.45;
  cursor: default;
}
.composer-send.stop {
  background: #c0392b;
}
.composer-send.stop:hover {
  background: #a93226;
}
.jump-bottom {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 3;
  border: 1px solid #c5d4e4;
  background: #fff;
  color: #1b4f72;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(21, 32, 43, 0.12);
}
.jump-bottom:hover {
  background: #eaf3fa;
}
.empty-main {
  display: grid;
  place-items: center;
  color: #7f8c8d;
}
.empty-card {
  display: grid;
  gap: 12px;
  justify-items: center;
  padding: 28px;
  background: #fff;
  border: 1px solid #dfe6ee;
  border-radius: 12px;
}
.empty-title {
  font-size: 0.95rem;
  color: #5d6d7e;
}

/* Shared dialog eyebrow — single meta line above the real title */
.dialog-eyebrow {
  margin: 0 0 6px;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: #7f8c8d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
}

/* Permission dialog — allow copying detail / capability text */
.perm-card {
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 16px 40px rgba(21, 32, 43, 0.18);
  user-select: text;
  -webkit-user-select: text;
}
.perm-head {
  flex-shrink: 0;
  overflow: hidden;
  padding: 20px 22px 14px;
  border-bottom: 1px solid #e8eef3;
  background:
    radial-gradient(600px 180px at 0% 0%, rgba(27, 79, 114, 0.08), transparent 60%),
    #fbfcfd;
}
.perm-title {
  margin: 0;
  font-size: 1.12rem;
  font-weight: 700;
  color: #15202b;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.perm-detail-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: #f4f8fb;
  border: 1px solid #e2ebf2;
}
.perm-detail-text {
  margin: 0;
  font-size: 0.84rem;
  color: #5d6d7e;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  overflow: hidden;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.perm-cap {
  display: inline-block;
  align-self: flex-start;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 6px;
  background: #eef3f7;
  color: #5d6d7e;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.perm-body {
  padding: 16px 22px 20px;
  display: grid;
  gap: 16px;
  user-select: none;
  -webkit-user-select: none;
}
.perm-group-label {
  font-size: 0.72rem;
  font-weight: 650;
  color: #7f8c8d;
  margin-bottom: 8px;
  letter-spacing: 0.02em;
}
.perm-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 10px;
}
.perm-stack {
  display: grid;
  gap: 8px;
}
.perm-btn {
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 11px 14px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.2;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.perm-btn.primary {
  background: #1b4f72;
  color: #fff;
}
.perm-btn.primary:hover {
  background: #163f5b;
}
.perm-btn.ghost {
  background: #fff;
  border-color: #d5dde5;
  color: #5d6d7e;
}
.perm-btn.ghost:hover {
  background: #f4f7fa;
  border-color: #c5d0db;
}
.perm-btn.tonal {
  background: #eef3f7;
  color: #1b4f72;
  text-align: left;
}
.perm-btn.tonal:hover {
  background: #e2ebf2;
}
.perm-btn.danger-ghost {
  background: transparent;
  border-color: transparent;
  color: #a93226;
  text-align: left;
  font-weight: 550;
  padding-top: 8px;
  padding-bottom: 8px;
}
.perm-btn.danger-ghost:hover {
  background: rgba(192, 57, 43, 0.08);
}

/* Agent ask dialog */
.ask-dialog-host {
  max-height: min(85vh, 720px) !important;
  display: flex !important;
  flex-direction: column;
  overflow: hidden !important;
}
.ask-card {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  max-height: min(85vh, 720px);
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 16px 40px rgba(21, 32, 43, 0.18);
  user-select: text;
  -webkit-user-select: text;
}
.ask-head {
  flex-shrink: 0;
  overflow: hidden;
  padding: 20px 22px 14px;
  border-bottom: 1px solid #e8eef3;
  background:
    radial-gradient(600px 180px at 0% 0%, rgba(27, 79, 114, 0.08), transparent 60%),
    #fbfcfd;
}
.ask-title {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 700;
  color: #15202b;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.ask-head-meta {
  margin: 6px 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: #5d6d7e;
  line-height: 1.35;
}
.ask-question-body {
  margin: 0;
  flex-shrink: 0;
  font-size: 0.88rem;
  font-weight: 500;
  color: #5d6d7e;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  overflow: hidden;
}
.ask-prior {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.ask-prior li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(27, 79, 114, 0.05);
  border: 1px solid #e2ebf2;
}
.ask-prior-q {
  font-size: 0.72rem;
  color: #7f8c8d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ask-prior-a {
  font-size: 0.82rem;
  font-weight: 600;
  color: #1b4f72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ask-dl-detail {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 12px;
  border-radius: 10px;
  background: #f4f8fb;
  border: 1px solid #e2ebf2;
}
.ask-dl-row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  min-width: 0;
}
.ask-dl-k {
  font-size: 0.72rem;
  font-weight: 700;
  color: #7f8c8d;
  letter-spacing: 0.02em;
}
.ask-dl-v {
  font-size: 0.84rem;
  font-weight: 600;
  color: #1b4f72;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ask-timeout {
  margin: 8px 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: #7f8c8d;
}
.ask-timeout.urgent {
  color: #b9770e;
}
.ask-countdown-bar {
  margin-top: 6px;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: #e4ecf2;
  overflow: hidden;
}
.ask-countdown-bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #5d8aa8;
  transition: width 0.45s linear, background-color 0.2s ease;
}
.ask-countdown-bar.urgent .ask-countdown-bar-fill {
  background: #c0392b;
}
.ask-fork-steps {
  margin-top: 10px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.ask-fork-step-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #d5e2ec;
}
.ask-fork-step-dot.done {
  background: #7f9bb0;
}
.ask-fork-step-dot.current {
  width: 18px;
  background: #1b4f72;
}
.ask-evidence {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(27, 79, 114, 0.06);
  border: 1px solid #d5e2ec;
}
.ask-evidence-label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #5d6d7e;
  margin-bottom: 4px;
}
.ask-evidence-title {
  font-size: 0.84rem;
  font-weight: 650;
  color: #15202b;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ask-evidence-url {
  margin-top: 2px;
  font-size: 0.72rem;
  color: #7f8c8d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ask-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 16px 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}
.ask-options {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: grid;
  gap: 8px;
  align-content: start;
  padding-right: 2px;
}
.ask-opt {
  border: 1px solid #d5dde5;
  border-radius: 9px;
  padding: 11px 14px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.25;
  text-align: left;
  background: #f7fafc;
  color: #1b4f72;
  transition: background 0.12s ease, border-color 0.12s ease;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}
.ask-opt-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ask-opt-label {
  flex: 1;
  min-width: 0;
}
.ask-opt-badge {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(27, 79, 114, 0.12);
  color: #1b4f72;
}
.ask-opt-hint {
  font-size: 0.76rem;
  font-weight: 500;
  color: #7f8c8d;
  line-height: 1.35;
}
.ask-opt:hover:not(:disabled) {
  background: #eaf3fa;
  border-color: #9fc0d8;
}
.ask-opt.recommended {
  border-color: #7eaccc;
  background: #eef6fb;
}
.ask-opt.primary {
  background: #1b4f72;
  border-color: #1b4f72;
  color: #fff;
  text-align: left;
  align-items: stretch;
}
.ask-opt.primary .ask-opt-hint {
  color: rgba(255, 255, 255, 0.78);
}
.ask-opt.primary .ask-opt-badge {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.ask-opt.primary:hover:not(:disabled) {
  background: #163f5b;
}
.ask-opt.danger {
  border-color: rgba(192, 57, 43, 0.35);
}
.ask-opt.danger:hover:not(:disabled) {
  border-color: rgba(192, 57, 43, 0.55);
  background: #fdf6f5;
}
.ask-opt:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ask-opt-custom {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  cursor: text;
  padding-top: 9px;
  padding-bottom: 9px;
  text-align: left;
}
.ask-opt-custom:hover {
  background: #eaf3fa;
  border-color: #9fc0d8;
}
.ask-opt-custom:focus-within {
  background: #eaf3fa;
  border-color: #1b4f72;
}
.ask-opt-custom-tag {
  flex-shrink: 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: #5d6d7e;
  letter-spacing: 0.02em;
}
.ask-opt-custom-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 0.88rem;
  font-weight: 600;
  color: #15202b;
  outline: none;
  line-height: 1.25;
}
.ask-opt-custom-input::placeholder {
  color: #95a5a6;
  font-weight: 500;
}
.ask-opt-custom-submit {
  flex-shrink: 0;
  border: 0;
  border-radius: 7px;
  padding: 6px 10px;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  background: #1b4f72;
  color: #fff;
  line-height: 1.2;
}
.ask-opt-custom-submit:hover:not(:disabled) {
  background: #163f5b;
}
.ask-opt-custom-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ask-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 2px;
}
.ask-shelve,
.ask-deny {
  border: 0;
  background: transparent;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 4px 0;
  line-height: 1.2;
}
.ask-shelve {
  color: #7f8c8d;
}
.ask-shelve:hover {
  color: #1b4f72;
}
.ask-deny {
  color: #c0392b;
  margin-left: auto;
}
.ask-deny:hover {
  color: #922b21;
}

.model-panel-trigger{max-width:min(350px,40vw);gap:7px}.model-trigger-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-trigger-tier{font-size:10px;flex-shrink:0;color:#69809a;background:#e8eef5;border-radius:5px;padding:2px 5px}.unified-model-panel{display:flex;flex-direction:column;max-height:calc(100dvh - 110px);overflow:hidden;width:min(390px,calc(100vw - 24px));max-width:calc(100vw - 24px);padding:10px!important}.model-panel-heading{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;color:#35465a;font-size:13px;font-weight:600;padding:2px 6px 9px}.model-panel-heading>button{width:26px;height:26px;border-radius:6px;color:#718095}.model-panel-heading>button:hover{background:#eaf0f6}.model-panel-search{flex-shrink:0;display:flex;align-items:center;gap:8px;background:#f7f9fb;border:1px solid #ced8e3;border-radius:8px;padding:8px 10px;margin-bottom:8px}.model-panel-search>svg{width:13px;color:#718197}.model-panel-search input{font-size:12px;min-width:0;width:100%;outline:0;color:#35465a}.model-panel-search:focus-within{border-color:#6688ad}.model-panel-options{min-height:0;flex:1;max-height:min(290px,35dvh);overflow:auto}.model-panel-options .composer-perm-item{width:100%;grid-template-columns:18px minmax(0,1fr) auto;text-align:left;gap:4px 9px;padding:9px}.model-panel-options .composer-perm-item-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-panel-options .composer-perm-item-desc{grid-column:2;grid-row:2;font-size:11px}.model-panel-options .composer-perm-check{grid-column:3;grid-row:1 / 3}.model-panel-reasoning{flex-shrink:0;border-top:1px solid #d5dee8;margin-top:8px;padding:12px 5px 4px;color:#5e6e82;font-size:12px}.model-panel-reasoning>div{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.model-panel-reasoning button{padding:5px 10px;border:1px solid #d0d9e3;border-radius:7px;color:#596a80;font-size:12px}.model-panel-reasoning button:hover{background:#edf2f7}.model-panel-reasoning button.selected{color:#355c85;background:#e8f0f8;border-color:#9bb3cc}.unified-model-panel button:focus-visible{outline:2px solid #557ca8;outline-offset:-2px}
</style>
<style>
.model-panel-reasoning{max-height:min(180px,25dvh);overflow:auto;overscroll-behavior:contain;flex:0 1 auto}.composer-usage-panel{max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain}
.model-provider-label{margin:8px 8px 4px;font-size:11px;font-weight:600;color:var(--navora-muted)}.composer-usage-actual{margin-top:12px;padding-top:10px;border-top:1px solid var(--navora-stroke);font-size:12px}.composer-usage-actual>strong{display:block;font-size:11px;margin-bottom:8px}.composer-usage-actual>p{font-size:11px;color:var(--navora-muted)}
</style>

<style>
.composer-perm-menu,
.composer-usage-menu {
  border-radius: 12px !important;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(21, 32, 43, 0.16) !important;
}
.composer-perm-panel,
.composer-usage-panel {
  min-width: 220px;
  max-width: 280px;
  padding: 10px;
  background: #fff;
}
.composer-perm-title,
.composer-usage-title {
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7f8c8d;
  padding: 4px 8px 8px;
}
.composer-perm-item {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto;
  column-gap: 10px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: #15202b;
}
.composer-perm-item:hover {
  background: #eaf3fa;
}
.composer-perm-item.active {
  background: #e8f1f8;
}
.composer-perm-item-icon {
  grid-column: 1;
  grid-row: 1 / span 2;
  align-self: center;
  width: 1.1rem;
  color: #1b4f72;
  opacity: 0.85;
  font-size: 0.92rem;
}
.composer-perm-item-label {
  font-size: 0.88rem;
  font-weight: 650;
  grid-column: 2;
  grid-row: 1;
}
.composer-perm-item-desc {
  font-size: 0.72rem;
  color: #7f8c8d;
  grid-column: 2;
  grid-row: 2;
}
.composer-perm-check {
  grid-column: 3;
  grid-row: 1 / span 2;
  align-self: center;
  color: #1b4f72;
  font-size: 0.78rem;
}
.composer-perm-item.disabled,
.composer-perm-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.composer-model-empty {
  margin: 0;
  padding: 8px 12px 10px;
  font-size: 0.78rem;
  color: #8a97a5;
}
.composer-perm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.workspace-chat-tools{display:flex;align-items:center;gap:2px;margin-left:auto}
.conversation-title-header:not(.compact) {
  min-height: 48px;
  padding: 8px 20px;
}
.conversation-title-header:not(.compact) .main-title {
  transform: none;
}
.composer-link-btn {
  width: 30px;
  height: 30px;
  max-width: 30px;
  flex: 0 0 30px;
  justify-content: center;
  padding: 0;
  font-size: 0.88rem;
}
.composer-link-panel {
  display: grid;
  gap: 9px;
  padding: 18px;
  border: 1px solid #dbe3ed;
  border-radius: 12px;
  background: #fff;
  color: #40536d;
  box-shadow: 0 16px 42px rgba(30, 48, 72, 0.18);
}
.composer-link-panel h2 {
  margin: 0;
  color: #263b55;
  font-size: 15px;
  font-weight: 650;
}
.composer-link-panel p {
  margin: 0;
  overflow: hidden;
  color: #75849a;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-link-panel label {
  color: #667991;
  font-size: 11px;
  font-weight: 600;
}
.composer-link-panel input {
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  border: 1px solid #ccd6e3;
  border-radius: 7px;
  outline: 0;
  color: #354c68;
  background: #fff;
  font: inherit;
  font-size: 12px;
}
.composer-link-panel input:focus {
  border-color: #6485ad;
  box-shadow: 0 0 0 3px rgba(83, 122, 185, 0.13);
}
.composer-link-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 3px;
}
.composer-link-actions button {
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid #d4dde8;
  border-radius: 7px;
  color: #62758d;
  background: #fff;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.composer-link-actions button[type='submit'] {
  border-color: #426b98;
  color: #fff;
  background: #426b98;
}
.composer-link-actions button:focus-visible {
  outline: 2px solid #6487b1;
  outline-offset: 2px;
}
.composer-usage-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 6px 8px;
  font-size: 0.84rem;
  color: #5d6d7e;
}
.composer-usage-row strong {
  color: #15202b;
  font-variant-numeric: tabular-nums;
}
.composer-usage-note {
  margin: 12px 2px 1px;
  font-size: 11px;
  color: #8993a0;
  line-height: 1.5;
}
.composer-usage-menu{max-width:calc(100vw - 20px)!important;border:1px solid #e6e9ee;border-radius:18px!important;background:#fff!important}
.composer-usage-panel{box-sizing:border-box;width:min(396px,calc(100vw - 20px));min-width:0;max-width:none;padding:16px 18px 14px;border-radius:18px}
.composer-usage-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#737c88;font-size:14px;line-height:1.3}
.composer-usage-heading>span{white-space:nowrap}
.composer-usage-heading b{margin-left:5px;color:#202631;font-size:15px;font-weight:650;font-variant-numeric:tabular-nums}
.composer-usage-heading>strong{color:#202631;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.composer-usage-track{height:6px;margin:17px 0 13px;overflow:hidden;border-radius:999px;background:#edf0f2}
.composer-usage-fill{display:block;height:100%;min-width:0;border-radius:inherit;background:#4b8dff;transition:width 180ms ease,background-color 180ms ease}
.composer-usage-fill.warm{background:#e9a43b}
.composer-usage-fill.hot{background:#df5d58}
.composer-usage-breakdown{display:grid;gap:1px}
.composer-usage-row{min-height:31px;padding:4px 0;font-size:14px;color:#68717d}
.composer-usage-row>span{display:inline-flex;align-items:center;gap:9px}
.composer-usage-row strong{font-size:14px;font-weight:500;color:#252b33}
.usage-dot{width:11px;height:11px;flex:0 0 11px;border-radius:3px;background:#aeb5bd}
.usage-dot.tools{background:#a787ff}
.usage-dot.message-history{background:#4b8dff}
.composer-usage-panel .composer-usage-note{border-top:1px solid #eef0f2;padding-top:9px}
@media(max-width:420px){.composer-usage-panel{padding:14px}.composer-usage-heading{font-size:13px}.composer-usage-heading>strong{font-size:12px}}

/* 搜索对话：teleport 到 body */
.chat-search-overlay {
  position: fixed;
  inset: 0;
  z-index: 2600;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 16px 24px;
  box-sizing: border-box;
  pointer-events: none;
}
.chat-search-scrim {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  background: rgba(21, 32, 43, 0.48);
  backdrop-filter: blur(16px) saturate(1.1);
  -webkit-backdrop-filter: blur(16px) saturate(1.1);
}
.chat-search-panel {
  position: relative;
  z-index: 1;
  pointer-events: auto;
  width: min(560px, 100%);
  max-height: min(60vh, 330px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 48px rgba(21, 32, 43, 0.22);
  overflow: hidden;
}
.chat-search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid #e8eef4;
}
.chat-search-lead {
  flex-shrink: 0;
  color: #7a8a99;
  font-size: 0.95rem;
}
.chat-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 1rem;
  color: #15202b;
}
.chat-search-input::placeholder {
  color: #9aa7b4;
}
.chat-search-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #8a97a5;
  cursor: pointer;
}
.chat-search-close:hover {
  background: #eef3f7;
  color: #1b4f72;
}
.chat-search-results {
  flex: 0 1 auto;
  min-height: 0;
  max-height: min(240px, 45vh);
  overflow: auto;
  padding: 8px;
}
.chat-search-hint {
  margin: 10px 8px;
  text-align: center;
  font-size: 0.86rem;
  color: #8a97a5;
}
.chat-search-hit {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px;
  text-align: left;
  padding: 10px 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font: inherit;
}
.chat-search-hit:hover {
  background: #eef3f7;
}
.chat-search-hit.active {
  background: #e8f1f7;
}
.chat-search-hit-title {
  font-size: 0.9rem;
  font-weight: 650;
  color: #15202b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-search-hit-snippet {
  grid-column: 1 / -1;
  font-size: 0.78rem;
  color: #5d6d7e;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.chat-search-hit-meta {
  grid-column: 2;
  grid-row: 1;
  font-size: 0.72rem;
  color: #9aa7b4;
}

.shell.mobile-layout {
  display: block;
  position: relative;
  height: 100dvh;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}
.shell.mobile-layout .sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: min(288px, 88vw);
  height: 100dvh;
  z-index: 1200;
  transform: translateX(-105%);
  transition: transform 0.22s ease;
  padding: 16px 8px 16px 12px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
}
.shell.mobile-layout .chat-list,
.shell.mobile-layout :deep(.res-tree) {
  padding-right: 6px;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(236, 240, 241, 0.28) transparent;
}
.shell.mobile-layout .chat-list::-webkit-scrollbar,
.shell.mobile-layout :deep(.res-tree)::-webkit-scrollbar {
  width: 4px;
}
.shell.mobile-layout .chat-list::-webkit-scrollbar-track,
.shell.mobile-layout :deep(.res-tree)::-webkit-scrollbar-track {
  background: transparent;
}
.shell.mobile-layout .chat-list::-webkit-scrollbar-thumb,
.shell.mobile-layout :deep(.res-tree)::-webkit-scrollbar-thumb {
  background: rgba(236, 240, 241, 0.28);
  border-radius: 999px;
}
.shell.mobile-layout .chat-list::-webkit-scrollbar-thumb:active,
.shell.mobile-layout :deep(.res-tree)::-webkit-scrollbar-thumb:active {
  background: rgba(236, 240, 241, 0.42);
}
.shell.mobile-layout .chat-item-main {
  padding-right: 34px;
}
.shell.mobile-layout.sidebar-open .sidebar {
  transform: translateX(0);
  box-shadow: 10px 0 36px rgba(0, 0, 0, 0.34);
}
.shell.mobile-layout .sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1190;
  background: rgba(10, 18, 28, 0.42);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.shell.mobile-layout .main {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}
.shell.mobile-layout .mobile-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: calc(8px + env(safe-area-inset-top, 0px)) 10px 8px;
  border-bottom: 1px solid #d5dde5;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(8px);
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

.shell.mobile-layout .mobile-topbar-center {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.shell.mobile-layout .mobile-topbar-titles {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow: hidden;
}
.shell.mobile-layout .mobile-topbar-title {
  font-size: 0.95rem;
  font-weight: 650;
  color: #15202b;
  line-height: 1.3;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  word-break: normal;
}
.shell.mobile-layout .mobile-topbar-title.is-sub {
  font-weight: 600;
}
.shell.mobile-layout .remote-badge {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #1b4f72;
  background: rgba(27, 79, 114, 0.12);
  border: 1px solid rgba(27, 79, 114, 0.18);
}
.shell.mobile-layout .mobile-topbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.shell.mobile-layout .mobile-topbar-btn,
.shell.mobile-layout .mobile-topbar-actions {
  -webkit-app-region: no-drag;
}
.shell.mobile-layout .mobile-topbar-btn {
  width: 38px;
  height: 38px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d5dde5;
  border-radius: 10px;
  background: #fff;
  color: #1b4f72;
  font-size: 0.95rem;
  cursor: pointer;
}
.shell.mobile-layout .mobile-topbar-btn:active {
  background: #eef3f7;
}
.shell.mobile-layout .subchat-spawn-bar {
  flex-wrap: wrap;
  align-items: flex-start;
}
.shell.mobile-layout .subchat-spawn-main {
  flex: 1 1 100%;
}
.shell.mobile-layout .main-top.compact {
  flex-shrink: 0;
  padding: 6px 12px;
  justify-content: stretch;
}
.shell.mobile-layout .main-top.compact .agent-live {
  width: 100%;
  max-width: none;
}
.shell.mobile-layout .messages-wrap {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}
.shell.mobile-layout .messages {
  width: 100%;
  max-width: 100%;
  gap: 8px;
  padding-inline: 12px;
}
.shell.mobile-layout .msg,
.shell.mobile-layout .msg-empty,
.shell.mobile-layout .thinking-row,
.shell.mobile-layout .followup-block,
.shell.mobile-layout .retry-bar,
.shell.mobile-layout .pending-ask-card,
.shell.mobile-layout .inchat-decision {
  width: 100%;
  max-width: 100%;
}
.shell.mobile-layout .composer {
  flex-shrink: 0;
  width: 100%;
  max-width: 100%;
  padding-inline: 10px;
  padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
}
.shell.mobile-layout .composer-box,
.shell.mobile-layout .chip-row {
  width: 100%;
  max-width: 100%;
}
.shell.mobile-layout .empty-main {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}
.shell.mobile-layout .composer-input :deep(textarea) {max-height:min(calc(1.45em * 8),32dvh);}
.shell.mobile-layout .chat-item {
  gap: 0;
  background: transparent;
}
.shell.mobile-layout .chat-sub-wrap {
  max-height: 96px;
  margin-left: 14px;
  margin-right: 4px;
}
.shell.mobile-layout .chat-sub-scroll {
  max-height: 96px;
}
.shell.mobile-layout .chat-sub-chip-more {
  opacity: 0.85;
}
.shell.mobile-layout .chat-item-track {
  touch-action: pan-y;
  background: #15202b;
  user-select: none;
  -webkit-user-select: none;
}
.shell.mobile-layout .chat-item.swiping .chat-item-track,
.shell.mobile-layout .chat-item.swipe-open .chat-item-track {
  touch-action: none;
}
.shell.mobile-layout .chat-item.swiping .chat-item-track {
  transition: none;
}
.shell.mobile-layout .chat-item:hover,
.shell.mobile-layout .chat-item.active {
  background: transparent;
}
.shell.mobile-layout .chat-item.active .chat-item-track {
  background: #1a3a52;
}
.shell.mobile-layout .chat-item:not(.active):hover .chat-item-track {
  background: #1b2733;
}
.shell.mobile-layout .chat-swipe-del {
  display: flex;
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 0;
  width: 76px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 0;
  border-radius: 0 8px 8px 0;
  background: #c0392b;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 650;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}
.shell.mobile-layout .chat-item.swiping .chat-swipe-del,
.shell.mobile-layout .chat-item.swipe-open .chat-swipe-del {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}
.shell.mobile-layout .chat-swipe-del :deep(svg) {
  font-size: 0.95rem;
}
.shell.mobile-layout .composer-perm-btn > span {
  display: none;
}
.shell.mobile-layout .composer-perm-btn {
  min-width: 40px;
  min-height: 40px;
  padding-inline: 10px;
  justify-content: center;
}
.shell.mobile-layout .composer-actions-right {
  gap: 6px;
}
.shell.mobile-layout :deep(.tree-actions .icon-btn) {
  width: 34px;
  height: 34px;
}
</style>
