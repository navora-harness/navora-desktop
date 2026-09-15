<template>
  <div
    class="shell"
    :class="{
      'mobile-layout': isMobileLayout,
      'remote-web': isWebRemote(),
      'sidebar-open': isMobileLayout && mobileSidebarOpen,
    }"
  >
    <div
      v-if="isMobileLayout && mobileSidebarOpen"
      class="sidebar-backdrop"
      aria-hidden="true"
      @click="closeMobileSidebar"
    />
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-top">
          <div class="brand-name">Navora</div>
          <button
            type="button"
            class="brand-search-btn"
            title="搜索对话"
            @click="openChatSearch"
          >
            <font-awesome-icon icon="magnifying-glass" />
          </button>
        </div>
        <div class="brand-sub">AI Agent Browser</div>
      </div>
      <div class="chat-toolbar">
        <Transition name="toolbar-swap" mode="out-in">
          <div v-if="!chatBatchMode" key="normal" class="chat-toolbar-row">
            <v-btn
              size="small"
              color="primary"
              variant="flat"
              class="new-chat-btn"
              @click="createChat"
            >
              <font-awesome-icon icon="pen-to-square" class="new-chat-icon" />
              开启新对话
            </v-btn>
            <Transition name="batch-btn-pop">
              <button
                v-if="chats.length"
                key="batch-enter"
                type="button"
                class="chat-toolbar-icon-btn"
                title="批量操作"
                aria-label="批量操作"
                @click="enterChatBatchMode"
              >
                <font-awesome-icon icon="list-check" />
              </button>
            </Transition>
          </div>
          <div v-else key="batch" class="chat-toolbar-row">
            <v-btn
              size="small"
              variant="tonal"
              class="batch-select-btn"
              @click="toggleBatchSelectAll"
            >
              {{ batchAllSelected ? '取消全选' : '全选' }}
            </v-btn>
            <button
              type="button"
              class="chat-toolbar-icon-btn"
              title="取消批量操作"
              aria-label="取消批量操作"
              @click="exitChatBatchMode"
            >
              取消
            </button>
          </div>
        </Transition>
      </div>
      <div class="chat-list" :class="{ 'batch-mode': chatBatchMode }">
        <template v-for="sec in chatListSections" :key="sec.key">
          <div class="chat-date-label">{{ sec.label }}</div>
          <template v-for="c in sec.items" :key="c.id">
            <div
              class="chat-item"
              :class="{
                active: !chatBatchMode && c.id === activeId,
                'branch-open': !chatBatchMode && isChatBranchExpanded(c.id),
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
              <font-awesome-icon icon="trash" />
              <span>删除</span>
            </button>
            <div
              class="chat-item-track"
              :style="chatBatchMode ? undefined : chatSwipeTrackStyle(c.id)"
              @touchstart.passive="chatBatchMode ? undefined : onChatTouchStart($event, c.id)"
              @touchmove="chatBatchMode ? undefined : onChatTouchMove($event, c.id)"
              @touchend="chatBatchMode ? undefined : onChatTouchEnd(c.id)"
              @touchcancel="chatBatchMode ? undefined : onChatTouchEnd(c.id)"
              @contextmenu.prevent.stop="onChatItemContext($event, c)"
            >
              <button type="button" class="chat-item-main" @click="onChatItemActivate(c.id)">
                <Transition name="batch-check">
                  <span
                    v-if="chatBatchMode"
                    class="chat-batch-check"
                    :class="{ on: batchSelectedIds.has(c.id) }"
                    aria-hidden="true"
                  >
                    <font-awesome-icon
                      :icon="batchSelectedIds.has(c.id) ? 'circle-check' : 'circle'"
                    />
                  </span>
                </Transition>
                <div class="chat-item-body">
                  <div class="chat-item-title">
                    <font-awesome-icon
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
                      :title="displayChatTitle(c.title)"
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
                      <font-awesome-icon
                        :icon="chatStatusById[c.id].icon"
                        :spin="Boolean(chatStatusById[c.id].spin)"
                      />
                    </button>
                  </div>
                  <div class="chat-item-meta">
                    <span class="chat-item-time">{{ formatRelative(c.updatedAt) }}</span>
                    <span class="chat-item-meta-end">
                      <span
                        v-if="!chatBatchMode && pendingAskForSidebar(c.id)"
                        class="badge ask-pending-badge"
                      >
                        {{
                          pendingAskBadge(pendingAskForSidebar(c.id)!.chatId) ||
                          (pendingAskForSidebar(c.id)!.chatId !== c.id ? '子任务' : '待决策')
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
                          <font-awesome-icon icon="window-maximize" />
                          <span class="chat-stat-num">{{ windowCounts[c.id] }}</span>
                        </span>
                        <span
                          v-if="subchatCountOf(c.id)"
                          class="chat-stat chat-stat-sub"
                          :title="`${subchatCountOf(c.id)} 个子对话`"
                          :aria-label="`${subchatCountOf(c.id)} 个子对话`"
                        >
                          <font-awesome-icon icon="sitemap" />
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
                    <font-awesome-icon
                      :icon="chatStatusById[c.id].icon"
                      :spin="Boolean(chatStatusById[c.id].spin)"
                    />
                  </button>
                </div>
                <div class="chat-item-trail-more">
                  <v-menu
                    :model-value="chatMoreOpenId === c.id"
                    location="bottom end"
                    :close-on-content-click="true"
                    content-class="chat-more-menu"
                    @update:model-value="(v) => onChatMoreOpen(c.id, v)"
                  >
                    <template #activator="{ props: menuProps }">
                      <button
                        type="button"
                        class="chat-more-btn"
                        title="更多"
                        aria-label="更多"
                        v-bind="menuProps"
                        @click.stop
                      >
                        <font-awesome-icon icon="ellipsis" />
                      </button>
                    </template>
                    <div class="chat-more-panel" role="menu">
                      <button
                        type="button"
                        class="chat-more-item"
                        role="menuitem"
                        @click="startRenameChat(c)"
                      >
                        <font-awesome-icon icon="pen-to-square" />
                        <span>修改标题</span>
                      </button>
                      <button
                        type="button"
                        class="chat-more-item"
                        role="menuitem"
                        @click="toggleChatPinned(c)"
                      >
                        <font-awesome-icon icon="thumbtack" />
                        <span>{{ c.pinned ? '取消置顶' : '置顶' }}</span>
                      </button>
                      <button
                        type="button"
                        class="chat-more-item danger"
                        role="menuitem"
                        @click="askDeleteChat(c)"
                      >
                        <font-awesome-icon icon="trash" />
                        <span>删除</span>
                      </button>
                    </div>
                  </v-menu>
                </div>
              </div>
            </div>
            </div>

            <div
              v-if="!chatBatchMode && isChatBranchExpanded(c.id) && subchatCountOf(c.id)"
              class="chat-sub-wrap"
            >
              <div class="chat-sub-rail" aria-hidden="true">
                <div
                  class="chat-sub-rail-thumb"
                  :class="{ show: subScrollNeedsBar(c.id) }"
                  :style="subScrollThumbStyle(c.id)"
                />
              </div>
              <div
                class="chat-sub-scroll"
                :ref="(el) => setSubScrollEl(c.id, el)"
                @scroll.passive="onSubListScroll(c.id)"
              >
                <div class="chat-sub-list">
                  <div
                    v-for="sub in subchatsOf(c.id)"
                    :key="sub.id"
                    class="chat-sub-chip"
                    :class="{
                      active: sub.id === activeId,
                      renaming: renamingChatId === sub.id,
                      'menu-open': chatMoreOpenId === sub.id,
                      running: Boolean(runningChats[sub.id] || sub.spawnStatus === 'running'),
                    }"
                    @contextmenu.prevent.stop="onChatItemContext($event, sub)"
                  >
                    <button
                      type="button"
                      class="chat-sub-chip-main"
                      :title="subchatTitleTooltip(sub)"
                      @click="onChatItemActivate(sub.id)"
                    >
                      <span
                        v-if="chatStatusById[sub.id]"
                        class="chat-sub-chip-status"
                        :class="chatStatusById[sub.id].tone"
                        :title="chatStatusById[sub.id].title"
                      >
                        <font-awesome-icon
                          :icon="chatStatusById[sub.id].icon"
                          :spin="Boolean(chatStatusById[sub.id].spin)"
                        />
                      </span>
                      <input
                        v-if="renamingChatId === sub.id"
                        :ref="(el) => setRenameInputRef(sub.id, el)"
                        v-model="renameDraft"
                        class="chat-sub-chip-input"
                        maxlength="80"
                        aria-label="修改子对话标题"
                        @click.stop
                        @focus="onRenameInputFocus"
                        @keydown.enter.prevent="commitRenameChat"
                        @keydown.escape.prevent="cancelRenameChat"
                        @blur="onRenameInputBlur"
                      />
                      <span v-else class="chat-sub-chip-title">{{ displaySubchatTitle(sub) }}</span>
                      <span
                        v-if="pendingAskForSidebar(sub.id)"
                        class="chat-sub-chip-ask"
                        :title="pendingAskBadge(sub.id) || '待决策'"
                      />
                    </button>
                    <v-menu
                      :model-value="chatMoreOpenId === sub.id"
                      location="bottom end"
                      :close-on-content-click="true"
                      content-class="chat-more-menu"
                      @update:model-value="(v) => onChatMoreOpen(sub.id, v)"
                    >
                      <template #activator="{ props: menuProps }">
                        <button
                          type="button"
                          class="chat-sub-chip-more"
                          title="更多"
                          aria-label="更多"
                          v-bind="menuProps"
                          @click.stop
                        >
                          <font-awesome-icon icon="ellipsis" />
                        </button>
                      </template>
                      <div class="chat-more-panel" role="menu">
                        <button
                          type="button"
                          class="chat-more-item"
                          role="menuitem"
                          @click="startRenameChat(sub)"
                        >
                          <font-awesome-icon icon="pen-to-square" />
                          <span>修改标题</span>
                        </button>
                        <button
                          type="button"
                          class="chat-more-item danger"
                          role="menuitem"
                          @click="askDeleteChat(sub)"
                        >
                          <font-awesome-icon icon="trash" />
                          <span>删除</span>
                        </button>
                      </div>
                    </v-menu>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>

      <Transition name="res-slide" mode="out-in">
        <div v-if="!chatBatchMode" key="resources" class="sidebar-dock">
          <WorkspaceFilesPanel :chat-id="activeId || ''" @notify="onPanelNotify" />
          <BrowserResourcesPanel
            :chat-id="activeId || ''"
            :tree="tree"
            :is-remote="isWebRemote()"
            :owner-label="treeOwnerLabel"
            :dnd-mime="DND_MIME"
            @add-ref="addRef"
            @ask-close-session="askCloseSession"
            @remote-view="openRemoteWindow"
            @notify="onPanelNotify"
          />
        </div>
        <div v-else key="batch-actions" class="batch-list-footer">
          <v-btn
            size="small"
            variant="tonal"
            class="batch-pin-btn"
            :disabled="!batchSelectedCount || batchPinning"
            :loading="batchPinning"
            @click="batchPinSelected"
          >
            <font-awesome-icon icon="thumbtack" class="batch-pin-icon" />
            {{ batchSelectionAllPinned ? '取消置顶' : '置顶'
            }}{{ batchSelectedCount ? ` ${batchSelectedCount}` : '' }}
          </v-btn>
          <v-btn
            size="small"
            color="error"
            variant="flat"
            class="batch-delete-btn"
            :disabled="!batchSelectedCount"
            @click="askBatchDeleteChats"
          >
            删除{{ batchSelectedCount ? ` ${batchSelectedCount}` : '' }}
          </v-btn>
        </div>
      </Transition>

      <div class="sidebar-foot">
        <div class="sidebar-foot-actions">
          <v-menu
            v-model="sidebarMoreOpen"
            location="top start"
            :close-on-content-click="true"
            content-class="sidebar-more-menu"
          >
            <template #activator="{ props: menuProps }">
              <button
                type="button"
                class="sidebar-icon-btn"
                title="更多"
                aria-label="更多"
                v-bind="menuProps"
              >
                <font-awesome-icon icon="ellipsis" />
              </button>
            </template>
            <div class="sidebar-more-panel" role="menu">
              <button
                type="button"
                class="sidebar-more-item"
                role="menuitem"
                @click="onMoreDocs"
              >
                <font-awesome-icon icon="book" />
                <span>使用文档</span>
              </button>
              <button
                v-if="isWebRemote()"
                type="button"
                class="sidebar-more-item"
                role="menuitem"
                @click="onMoreRemoteWindows"
              >
                <font-awesome-icon icon="window-maximize" />
                <span>远程窗口</span>
              </button>
              <button
                type="button"
                class="sidebar-more-item"
                role="menuitem"
                :disabled="!activeId || exportingChat"
                @click="onMoreExport"
              >
                <font-awesome-icon icon="file-export" />
                <span>导出对话</span>
              </button>
              <button
                v-if="!isWebRemote()"
                type="button"
                class="sidebar-more-item danger"
                role="menuitem"
                @click="onMoreQuit"
              >
                <font-awesome-icon icon="right-from-bracket" />
                <span>退出程序</span>
              </button>
            </div>
          </v-menu>
          <div class="sidebar-foot-end">
            <BrowserDownloadsMenu :chat-id="activeId" />
            <button
              type="button"
              class="sidebar-icon-btn sidebar-settings-btn"
              title="设置"
              @click="settingsOpen = true"
            >
              <font-awesome-icon icon="gear" />
            </button>
          </div>
        </div>
      </div>
    </aside>

    <main class="main">
      <header v-if="isMobileLayout" class="mobile-topbar">
        <button
          v-if="active?.kind === 'sub' && active.parentChatId"
          type="button"
          class="mobile-topbar-btn"
          aria-label="返回"
          @click="selectChat(active.parentChatId)"
        >
          <font-awesome-icon icon="arrow-left" />
        </button>
        <button
          v-else
          type="button"
          class="mobile-topbar-btn"
          aria-label="打开菜单"
          @click="openMobileSidebar"
        >
          <font-awesome-icon icon="bars" />
        </button>
        <div class="mobile-topbar-center">
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
        <div class="mobile-topbar-actions">
          <button
            v-if="isWebRemote()"
            type="button"
            class="mobile-topbar-btn"
            aria-label="远程窗口"
            @click="openRemoteWindows"
          >
            <font-awesome-icon icon="window-maximize" />
          </button>
          <BrowserDownloadsMenu
            :chat-id="activeId"
            location="bottom end"
            btn-class="mobile-topbar-btn"
          />
          <button
            type="button"
            class="mobile-topbar-btn"
            aria-label="设置"
            @click="settingsOpen = true"
          >
            <font-awesome-icon icon="gear" />
          </button>
        </div>
      </header>
      <template v-if="active">
        <header
          v-if="!isMobileLayout || agentRunning"
          class="main-top"
          :class="{ compact: isMobileLayout }"
        >
          <div v-if="!isMobileLayout" class="main-top-text">
            <div v-if="active.kind === 'sub'" class="subchat-banner">
              <button
                type="button"
                class="subchat-back"
                :disabled="!active.parentChatId"
                @click="active.parentChatId && selectChat(active.parentChatId)"
              >
                <font-awesome-icon icon="arrow-left" />
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
            <span class="pulse-ring" />
            <span class="agent-live-text">{{ phaseLabel }}</span>
            <span class="agent-elapsed">{{ elapsedLabel }}</span>
          </div>
        </header>

        <div class="messages-wrap">
          <section
            ref="msgBox"
            class="messages"
            @scroll="onMessagesScroll"
            @click="onMessagesClick"
            @contextmenu.prevent="onMessagesContext"
          >
            <div v-if="!active.messages.length && !agentRunning" class="msg-empty">
              <div class="msg-empty-title">开始一段对话</div>
              <p class="msg-empty-desc">描述你想完成的浏览任务，或点选下方推荐；也可拖入左侧 Session / 窗口作为上下文。</p>
              <div class="suggest-marquee" aria-label="推荐对话">
                <div
                  v-for="(row, rowIdx) in suggestionRows"
                  :key="rowIdx"
                  class="suggest-rail"
                  :class="rowIdx % 2 === 1 ? 'reverse' : ''"
                >
                  <div class="suggest-track">
                    <button
                      v-for="(s, i) in [...row, ...row]"
                      :key="`${rowIdx}-${i}-${s}`"
                      type="button"
                      class="suggest-chip"
                      :tabindex="i < row.length ? 0 : -1"
                      :aria-hidden="i >= row.length ? 'true' : undefined"
                      @click="useSuggestion(s)"
                    >
                      {{ s }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <template v-for="block in messageBlocks" :key="block.key">
              <div v-if="block.type === 'run'" class="msg run">
                <div class="msg-row">
                  <div class="msg-avatar run" aria-hidden="true">
                    <font-awesome-icon icon="wrench" />
                  </div>
                  <div class="msg-main">
                    <div class="msg-role">
                      <span>{{ TOOL_RUN_GROUP_LABEL }}</span>
                    </div>
                    <div
                      class="run-card"
                      :class="{
                        open: isRunExpanded(block.key),
                        live: runGroupLive(block.items),
                        error: runGroupHasError(block.items),
                        aborted: !runGroupHasError(block.items) && runGroupWasAborted(block.items),
                      }"
                    >
                      <button
                        type="button"
                        class="run-card-head"
                        @click="toggleRun(block.key)"
                      >
                        <span class="run-status">
                          <span v-if="runGroupLive(block.items)" class="spin" />
                          <font-awesome-icon
                            v-else-if="runGroupHasError(block.items)"
                            icon="xmark"
                          />
                          <font-awesome-icon
                            v-else-if="runGroupWasAborted(block.items)"
                            icon="stop"
                          />
                          <font-awesome-icon v-else icon="check" />
                        </span>
                        <span class="run-card-text">{{ runGroupSummary(block.items) }}</span>
                        <span class="run-card-chevron">
                          <font-awesome-icon
                            :icon="isRunExpanded(block.key) ? 'chevron-down' : 'chevron-right'"
                          />
                        </span>
                      </button>
                      <div v-if="isRunExpanded(block.key)" class="run-card-body">
                        <template v-for="item in block.items" :key="item.id">
                          <div v-if="item.role === 'log'" class="run-item log">
                            <span class="log-kind-chip">{{ logKindText(item) }}</span>
                            <span class="run-item-text">{{ logFullText(item) }}</span>
                          </div>
                          <div
                            v-else
                            class="run-item tool"
                            :class="[toolStatusClass(item), `kind-${toolDisplay(item).kind}`]"
                          >
                            <div class="tool-card" :class="{ open: expandedTools[item.id] }">
                              <button
                                type="button"
                                class="tool-head"
                                @click="toggleTool(item.id)"
                              >
                                <span class="tool-status" :class="effectiveToolStatus(item)">
                                  <span
                                    v-if="effectiveToolStatus(item) === 'running'"
                                    class="spin"
                                  />
                                  <font-awesome-icon
                                    v-else-if="effectiveToolStatus(item) === 'error'"
                                    icon="xmark"
                                  />
                                  <font-awesome-icon
                                    v-else-if="effectiveToolStatus(item) === 'aborted'"
                                    icon="stop"
                                  />
                                  <font-awesome-icon v-else icon="check" />
                                </span>
                                <span class="tool-kind-chip" :class="toolDisplay(item).kind">{{
                                  toolDisplay(item).label
                                }}</span>
                                <span
                                  v-if="toolHeadTitle(item)"
                                  class="tool-title"
                                  >{{ toolHeadTitle(item) }}</span
                                >
                                <span
                                  v-if="toolHeadRaw(item)"
                                  class="tool-raw"
                                  >{{ toolHeadRaw(item) }}</span
                                >
                                <span class="tool-head-spacer" aria-hidden="true" />
                                <span class="tool-chevron">
                                  <font-awesome-icon
                                    :icon="expandedTools[item.id] ? 'chevron-down' : 'chevron-right'"
                                  />
                                </span>
                              </button>
                              <div
                                v-if="toolDownloadProgress(item)"
                                class="tool-dl-progress"
                              >
                                <div
                                  class="tool-dl-bar"
                                  :class="{ indeterminate: toolDownloadProgress(item)!.indeterminate }"
                                  role="progressbar"
                                  :aria-valuenow="toolDownloadProgress(item)!.percent ?? undefined"
                                  aria-valuemin="0"
                                  aria-valuemax="100"
                                  :aria-label="toolDownloadProgressLabel(item)"
                                >
                                  <div
                                    class="tool-dl-fill"
                                    :style="
                                      toolDownloadProgress(item)!.indeterminate
                                        ? undefined
                                        : { width: `${toolDownloadProgress(item)!.percent ?? 0}%` }
                                    "
                                  />
                                </div>
                                <span class="tool-dl-label">{{ toolDownloadProgressLabel(item) }}</span>
                              </div>
                              <div
                                v-if="toolMediaSrc[item.id]"
                                class="tool-media"
                                @click.stop="
                                  openLightbox(
                                    toolMediaSrc[item.id],
                                    toolMediaPath(item) || '',
                                  )
                                "
                              >
                                <img :src="toolMediaSrc[item.id]" alt="" loading="lazy" />
                                <span v-if="toolMediaPath(item)" class="tool-media-path">{{
                                  toolMediaPath(item)
                                }}</span>
                              </div>
                              <ToolCatalogList :message="item" />
                              <div v-if="expandedTools[item.id]" class="tool-detail">
                                <div v-if="item.meta?.args" class="tool-section">
                                  <div class="tool-sec-label">参数</div>
                                  <pre>{{ formatJson(item.meta.args) }}</pre>
                                </div>
                                <div class="tool-section">
                                  <div class="tool-sec-label">结果</div>
                                  <pre>{{ item.content }}</pre>
                                </div>
                              </div>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else-if="block.type === 'log'"
                class="msg log"
                :class="logToneClass(block.message)"
              >
                <div class="msg-row">
                  <div class="msg-avatar log" aria-hidden="true">
                    <font-awesome-icon icon="clipboard-list" />
                  </div>
                  <div class="msg-main">
                    <div class="msg-role">
                      <span>日志</span>
                      <span class="msg-time" :title="formatTime(block.message.createdAt)">{{
                        formatRelative(block.message.createdAt)
                      }}</span>
                    </div>
                    <div
                      class="log-card"
                      :class="{
                        open: isLogExpanded(block.message.id),
                        expandable: logCanExpand(block.message),
                      }"
                    >
                      <div
                        class="log-card-head"
                        role="button"
                        :tabindex="logCanExpand(block.message) ? 0 : -1"
                        :aria-expanded="
                          logCanExpand(block.message) ? isLogExpanded(block.message.id) : undefined
                        "
                        @click="onLogCardActivate(block.message, $event)"
                        @keydown.enter.prevent="onLogCardActivate(block.message, $event)"
                        @keydown.space.prevent="onLogCardActivate(block.message, $event)"
                      >
                        <span class="log-kind-chip">{{ logKindText(block.message) }}</span>
                        <span
                          class="log-card-text"
                          :class="{ clamped: !isLogExpanded(block.message.id) }"
                          :ref="(el) => measureLogOverflow(block.message.id, el, block.message)"
                          >{{ logFullText(block.message) }}</span
                        >
                        <span v-if="logCanExpand(block.message)" class="log-card-chevron">
                          <font-awesome-icon
                            :icon="isLogExpanded(block.message.id) ? 'chevron-down' : 'chevron-right'"
                          />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else-if="block.type === 'tool'"
                class="msg"
                :class="['tool', toolStatusClass(block.message), `kind-${toolDisplay(block.message).kind}`]"
              >
                <div class="msg-row">
                  <div
                    class="msg-avatar tool"
                    :class="toolDisplay(block.message).kind"
                    aria-hidden="true"
                  >
                    <font-awesome-icon :icon="toolDisplay(block.message).icon" />
                  </div>
                  <div class="msg-main">
                    <div class="msg-role">
                      <span>{{ toolDisplay(block.message).label }}</span>
                      <span class="msg-time" :title="formatTime(block.message.createdAt)">{{
                        formatRelative(block.message.createdAt)
                      }}</span>
                    </div>
                    <div class="tool-card" :class="{ open: expandedTools[block.message.id] }">
                      <button type="button" class="tool-head" @click="toggleTool(block.message.id)">
                        <span class="tool-status" :class="effectiveToolStatus(block.message)">
                          <span v-if="effectiveToolStatus(block.message) === 'running'" class="spin" />
                          <font-awesome-icon
                            v-else-if="effectiveToolStatus(block.message) === 'error'"
                            icon="xmark"
                          />
                          <font-awesome-icon
                            v-else-if="effectiveToolStatus(block.message) === 'aborted'"
                            icon="stop"
                          />
                          <font-awesome-icon v-else icon="check" />
                        </span>
                        <span class="tool-title" v-if="toolHeadTitle(block.message)">{{
                          toolHeadTitle(block.message)
                        }}</span>
                        <span class="tool-raw" v-if="toolHeadRaw(block.message)">{{
                          toolHeadRaw(block.message)
                        }}</span>
                        <span class="tool-head-spacer" aria-hidden="true" />
                        <span class="tool-chevron">
                          <font-awesome-icon
                            :icon="expandedTools[block.message.id] ? 'chevron-down' : 'chevron-right'"
                          />
                        </span>
                      </button>
                      <div
                        v-if="isSubchatSpawnTool(block.message)"
                        class="subchat-spawn-bar"
                      >
                        <div class="subchat-spawn-main">
                          <span
                            class="subchat-spawn-status"
                            :class="spawnStatusOf(block.message)"
                            >{{ spawnStatusLabel(block.message) }}</span
                          >
                          <button
                            type="button"
                            class="subchat-spawn-goal"
                            :class="{
                              deleted: isSpawnSubchatDeleted(block.message),
                              link: !isSpawnSubchatDeleted(block.message) && !!spawnSubChatId(block.message),
                            }"
                            :disabled="
                              !spawnSubChatId(block.message) || isSpawnSubchatDeleted(block.message)
                            "
                            :title="
                              isSpawnSubchatDeleted(block.message)
                                ? spawnGoalLabel(block.message)
                                : `打开子对话：${spawnGoalLabel(block.message)}`
                            "
                            @click.stop="openSubchatFromTool(block.message)"
                          >
                            {{ spawnGoalLabel(block.message) }}
                          </button>
                        </div>
                      </div>
                      <div
                        v-if="toolDownloadProgress(block.message)"
                        class="tool-dl-progress"
                      >
                        <div
                          class="tool-dl-bar"
                          :class="{
                            indeterminate: toolDownloadProgress(block.message)!.indeterminate,
                          }"
                          role="progressbar"
                          :aria-valuenow="toolDownloadProgress(block.message)!.percent ?? undefined"
                          aria-valuemin="0"
                          aria-valuemax="100"
                          :aria-label="toolDownloadProgressLabel(block.message)"
                        >
                          <div
                            class="tool-dl-fill"
                            :style="
                              toolDownloadProgress(block.message)!.indeterminate
                                ? undefined
                                : {
                                    width: `${toolDownloadProgress(block.message)!.percent ?? 0}%`,
                                  }
                            "
                          />
                        </div>
                        <span class="tool-dl-label">{{
                          toolDownloadProgressLabel(block.message)
                        }}</span>
                      </div>
                      <div
                        v-if="toolMediaSrc[block.message.id]"
                        class="tool-media"
                        @click.stop="
                          openLightbox(
                            toolMediaSrc[block.message.id],
                            toolMediaPath(block.message) || '',
                          )
                        "
                      >
                        <img :src="toolMediaSrc[block.message.id]" alt="" loading="lazy" />
                        <span v-if="toolMediaPath(block.message)" class="tool-media-path">{{
                          toolMediaPath(block.message)
                        }}</span>
                      </div>
                      <ToolCatalogList :message="block.message" />
                      <div v-if="expandedTools[block.message.id]" class="tool-detail">
                        <div v-if="block.message.meta?.args" class="tool-section">
                          <div class="tool-sec-label">参数</div>
                          <pre>{{ formatJson(block.message.meta.args) }}</pre>
                        </div>
                        <div class="tool-section">
                          <div class="tool-sec-label">结果</div>
                          <pre>{{ block.message.content }}</pre>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else
                class="msg"
                :class="[block.message.role]"
              >
                <div class="msg-row">
                  <div class="msg-avatar" :class="block.message.role" aria-hidden="true">
                    <img v-if="block.message.role === 'assistant'" src="/app-icon.png" alt="" />
                    <span v-else-if="block.message.role === 'user'">你</span>
                    <font-awesome-icon v-else icon="clipboard-list" />
                  </div>
                  <div class="msg-main">
                    <div class="msg-role">
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
                    <template v-if="block.message.role === 'assistant' || block.message.role === 'user'">
                      <div
                        v-if="block.message.role === 'assistant' && messageReasoning(block.message)"
                        class="msg-reasoning"
                        :class="{ open: isReasoningExpanded(block.message.id) }"
                      >
                        <button
                          type="button"
                          class="msg-reasoning-toggle"
                          :aria-expanded="isReasoningExpanded(block.message.id)"
                          @click="toggleReasoning(block.message.id)"
                        >
                          <font-awesome-icon
                            class="msg-reasoning-chevron"
                            :icon="
                              isReasoningExpanded(block.message.id)
                                ? 'chevron-down'
                                : 'chevron-right'
                            "
                          />
                          <span>思考</span>
                        </button>
                        <div
                          v-if="isReasoningExpanded(block.message.id)"
                          class="msg-reasoning-body"
                        >
                          {{ messageReasoning(block.message) }}
                        </div>
                      </div>
                      <button
                        v-if="
                          block.message.role === 'assistant' &&
                          showReadPages &&
                          messageSources(block.message).length
                        "
                        type="button"
                        class="read-pages-bar"
                        :class="{ active: readPagesPanelOpen && readPagesPanelFromId === block.message.id }"
                        @click="toggleReadPagesPanel(block.message.id, messageSources(block.message))"
                      >
                        <span class="read-pages-text"
                          >已阅读 {{ messageSources(block.message).length }} 个网页</span
                        >
                        <span class="read-pages-icons" aria-hidden="true">
                          <img
                            v-for="(s, i) in messageSources(block.message).slice(0, 4)"
                            :key="`${s.url}-${i}`"
                            class="read-pages-icon"
                            :src="s.favicon || faviconFallback(s.url)"
                            :alt="s.siteName || ''"
                            loading="lazy"
                            @error="onFaviconError"
                          />
                        </span>
                        <font-awesome-icon icon="chevron-down" class="read-pages-chevron" />
                      </button>
                      <ChatMarkdown
                        :chat-id="activeId || ''"
                        :content="displayMessageContent(block.message)"
                        :shimmer="isMessageShimmer(block.message)"
                        @open-media="(p) => openLightbox(p.src, p.alt)"
                      >
                        <template v-if="assistantElapsedLabel(block.message)" #footer>
                          <span class="msg-elapsed">{{ assistantElapsedLabel(block.message) }}</span>
                        </template>
                      </ChatMarkdown>
                    </template>
                    <div v-else class="msg-body">{{ block.message.content }}</div>
                  </div>
                </div>
              </div>
            </template>

            <button
              v-if="showInlinePendingAsk"
              ref="inlineAskCardEl"
              type="button"
              class="msg pending-ask-card"
              @click="openActivePendingAsk"
            >
              <div class="msg-row">
                <div class="msg-avatar pending-ask" aria-hidden="true">
                  <font-awesome-icon icon="circle-question" />
                </div>
                <div class="msg-main">
                  <div class="msg-role">
                    <span>待决策</span>
                    <span v-if="inlineAskProgress" class="pending-ask-step">{{
                      inlineAskProgress
                    }}</span>
                  </div>
                  <div class="pending-ask-question">{{ activePendingAsk?.question }}</div>
                  <div v-if="inlineAskRemainingLabel" class="pending-ask-timeout-block">
                    <div class="pending-ask-timeout">{{ inlineAskRemainingLabel }}</div>
                    <div
                      class="ask-countdown-bar"
                      :class="{ urgent: inlineAskRemainingUrgent }"
                      role="progressbar"
                      :aria-valuenow="inlineAskRemainingPct"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      :aria-label="inlineAskRemainingLabel"
                    >
                      <div
                        class="ask-countdown-bar-fill"
                        :style="{ width: `${inlineAskRemainingPct}%` }"
                      />
                    </div>
                  </div>
                  <div class="pending-ask-cta">
                    <span>点击打开选项并回答</span>
                    <font-awesome-icon icon="chevron-right" />
                  </div>
                </div>
              </div>
            </button>

            <div v-if="agentRunning && !showInlinePendingAsk" class="thinking-row" aria-live="polite">
              <div class="thinking-avatar" aria-hidden="true">
                <img src="/app-icon.png" alt="" />
              </div>
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
                <div v-if="liveReasoningText" class="thinking-reason">
                  <button
                    type="button"
                    class="thinking-reason-toggle"
                    :aria-expanded="liveReasoningOpen"
                    @click="toggleLiveReasoning"
                  >
                    <font-awesome-icon
                      class="thinking-reason-chevron"
                      :icon="liveReasoningOpen ? 'chevron-down' : 'chevron-right'"
                    />
                    <span class="thinking-reason-title">
                      思考
                      <span v-if="liveReasoningRoundLabel" class="thinking-reason-round">{{
                        liveReasoningRoundLabel
                      }}</span>
                    </span>
                  </button>
                  <div
                    v-if="liveReasoningOpen"
                    ref="liveReasoningBodyEl"
                    class="thinking-reason-body"
                  >
                    {{ liveReasoningText }}
                  </div>
                </div>
                <div v-else class="thinking-dots" aria-hidden="true">
                  <span /><span /><span />
                </div>
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
                <font-awesome-icon icon="arrow-rotate-right" class="mr-1" />
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

          <button
            v-if="showJumpBottom"
            type="button"
            class="jump-bottom"
            title="回到底部"
            @click="jumpToBottom"
          >
            <font-awesome-icon icon="arrow-down" class="mr-1" />
            回到底部
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
            v-if="showInlinePendingAsk"
            type="button"
            class="pending-ask-dock"
            @click="openActivePendingAsk"
          >
            <font-awesome-icon icon="circle-question" class="pending-ask-dock-icon" />
            <span class="pending-ask-dock-body">
              <span class="pending-ask-dock-label">
                待决策
                <template v-if="inlineAskProgress"> · {{ inlineAskProgress }}</template>
              </span>
              <span class="pending-ask-dock-q">{{ activePendingAsk?.question }}</span>
            </span>
            <span v-if="inlineAskRemainingLabel" class="pending-ask-dock-timeout">{{
              inlineAskRemainingLabel
            }}</span>
            <span class="pending-ask-dock-action">回答</span>
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
          <div v-if="contextRefs.length" class="chip-row">
            <span v-for="r in contextRefs" :key="refKey(r)" class="chip editable" :class="r.kind">
              <span class="chip-text">{{ chipLabel(r) }}</span>
              <button type="button" class="chip-x" aria-label="移除" @click="removeRef(r)">
                <font-awesome-icon icon="xmark" />
              </button>
            </span>
            <button type="button" class="chip-clear" @click="contextRefs = []">清空</button>
          </div>
          <div
            class="composer-box"
            :class="{ expanded: composerExpanded }"
            @contextmenu.prevent="onComposerContext"
          >
            <div class="composer-input-row">
              <v-textarea
                ref="draftField"
                v-model="draft"
                :rows="composerExpanded ? 10 : 1"
                auto-grow
                :max-rows="composerExpanded ? 10 : 3"
                hide-details
                variant="solo"
                flat
                bg-color="transparent"
                class="composer-input"
                :placeholder="agentRunning ? 'Agent 运行中… 按 Esc 可停止' : '描述任务，或拖入 Session / 窗口…'"
                :disabled="false"
                :maxlength="maxComposerChars"
                @keydown="onComposerKeydown"
              />
              <button
                type="button"
                class="composer-expand"
                :title="composerExpanded ? '收起输入框' : '展开输入框'"
                :aria-label="composerExpanded ? '收起输入框' : '展开输入框'"
                @click="composerExpanded = !composerExpanded"
              >
                <font-awesome-icon :icon="composerExpanded ? 'angles-down' : 'angles-up'" />
              </button>
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
                <v-menu
                  v-model="permMenuOpen"
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
                      <font-awesome-icon :icon="permPresetIcon" />
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
                      <font-awesome-icon :icon="opt.icon" class="composer-perm-item-icon" />
                      <span class="composer-perm-item-label">{{ opt.title }}</span>
                      <span class="composer-perm-item-desc">{{ opt.desc }}</span>
                      <font-awesome-icon
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
                  location="top end"
                  :close-on-content-click="true"
                  :disabled="agentRunning"
                  content-class="composer-perm-menu"
                >
                  <template #activator="{ props: menuProps }">
                    <button
                      type="button"
                      class="composer-perm-btn"
                      v-bind="menuProps"
                      :disabled="agentRunning"
                      title="本会话模型"
                      aria-label="本会话模型"
                    >
                      <font-awesome-icon icon="microchip" />
                      <span>{{ chatModelLabel }}</span>
                    </button>
                  </template>
                  <div class="composer-perm-panel" role="menu">
                    <div class="composer-perm-title">本会话模型</div>
                    <button
                      v-for="opt in modelMenuOptions"
                      :key="opt.key"
                      type="button"
                      class="composer-perm-item"
                      :class="{ active: opt.key === chatModelKey }"
                      role="menuitem"
                      :title="`${opt.providerLabel} · ${opt.model}${opt.hasKey ? '' : '（未配置 Key，仍可使用）'}`"
                      @click="applyChatModel(opt.providerId, opt.model)"
                    >
                      <font-awesome-icon icon="microchip" class="composer-perm-item-icon" />
                      <span class="composer-perm-item-label">{{ opt.model }}</span>
                      <span class="composer-perm-item-desc">{{
                        opt.hasKey ? opt.providerLabel : `${opt.providerLabel} · 无 Key`
                      }}</span>
                      <font-awesome-icon
                        v-if="opt.key === chatModelKey"
                        icon="check"
                        class="composer-perm-check"
                      />
                    </button>
                    <p v-if="!modelMenuOptions.length" class="composer-model-empty">
                      暂无模型，请到设置添加
                    </p>
                  </div>
                </v-menu>

                <v-menu
                  v-model="usageMenuOpen"
                  location="top end"
                  :close-on-content-click="true"
                  content-class="composer-usage-menu"
                >
                  <template #activator="{ props: menuProps }">
                    <button
                      type="button"
                      class="usage-ring-btn"
                      v-bind="menuProps"
                      title="Content 用量"
                      aria-label="Content 用量"
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
                    <div class="composer-usage-title">Content 用量</div>
                    <div class="composer-usage-row">
                      <span>字符</span>
                      <strong>{{ usageChars.toLocaleString() }}</strong>
                    </div>
                    <div class="composer-usage-row">
                      <span>约估 token</span>
                      <strong>{{ usageTokensEst.toLocaleString() }}</strong>
                    </div>
                    <div class="composer-usage-row">
                      <span>占比</span>
                      <strong>{{ usagePctLabel }}</strong>
                    </div>
                    <p class="composer-usage-note">
                      按本会话消息字符估算，预算约 {{ CONTENT_BUDGET_CHARS.toLocaleString() }} 字符。
                    </p>
                  </div>
                </v-menu>

                <button
                  v-if="!agentRunning"
                  type="button"
                  class="composer-send"
                  :disabled="!canSend || sending"
                  :aria-busy="sending"
                  title="发送"
                  aria-label="发送"
                  @click="send"
                >
                  <font-awesome-icon icon="arrow-up" />
                </button>
                <button
                  v-else
                  type="button"
                  class="composer-send stop"
                  title="停止"
                  aria-label="停止"
                  @click="stopAgent"
                >
                  <font-awesome-icon icon="stop" />
                </button>
              </div>
            </div>
          </div>
        </footer>
      </template>
      <div v-else class="empty-main">
        <div class="empty-card">
          <div class="empty-title">还没有选中的 Chat</div>
          <v-btn color="primary" size="small" @click="createChat">
            <font-awesome-icon icon="pen-to-square" class="new-chat-icon" />
            开启新对话
          </v-btn>
        </div>
      </div>
    </main>

    <v-dialog
      :model-value="readPagesPanelOpen"
      max-width="540"
      scrollable
      content-class="read-pages-dialog-host"
      @update:model-value="onReadPagesDialog"
    >
      <div class="read-pages-dialog" aria-label="已阅读网页">
        <header class="read-pages-dialog-head">
          <div>
            <h2>已阅读网页</h2>
            <p>{{ readPagesPanelList.length }} 个来源</p>
          </div>
          <button type="button" class="read-pages-dialog-close" title="关闭" @click="closeReadPagesPanel">
            <font-awesome-icon icon="xmark" />
          </button>
        </header>
        <div class="read-pages-dialog-list">
          <button
            v-for="(s, i) in readPagesPanelList"
            :key="`${s.url}-${i}`"
            type="button"
            class="read-page-card"
            @click="openSourceUrl(s.url)"
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
    </v-dialog>

    <v-dialog v-model="permDialog" max-width="440" persistent>
      <div v-if="permReq" class="perm-card">
        <header class="perm-head">
          <p class="dialog-eyebrow">{{ permEyebrow }}</p>
          <h2 class="perm-title" :title="permCapabilityLabel">{{ permCapabilityLabel }}</h2>
          <p v-if="permRemainingLabel" class="ask-timeout" :class="{ urgent: permRemainingUrgent }">
            {{ permRemainingLabel }}
          </p>
          <div
            v-if="permRemainingLabel"
            class="ask-countdown-bar"
            :class="{ urgent: permRemainingUrgent }"
            role="progressbar"
            :aria-valuenow="permRemainingPct"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="permRemainingLabel"
          >
            <div class="ask-countdown-bar-fill" :style="{ width: `${permRemainingPct}%` }" />
          </div>
        </header>

        <div class="perm-body">
          <div v-if="permReq.detail" class="perm-detail-card">
            <div class="perm-detail-text" :title="permReq.detail">{{ permReq.detail }}</div>
            <code class="perm-cap" :title="permReq.capability">{{ permReq.capability }}</code>
          </div>

          <div class="perm-group">
            <div class="perm-group-label">本次操作</div>
            <div class="perm-row">
              <button type="button" class="perm-btn primary" @click="respondPerm('allow')">
                允许一次
              </button>
              <button type="button" class="perm-btn ghost" @click="respondPerm('deny')">
                拒绝
              </button>
            </div>
          </div>

          <div class="perm-group">
            <div class="perm-group-label">记住选择</div>
            <div class="perm-stack">
              <button type="button" class="perm-btn tonal" @click="respondPerm('allow_chat')">
                本 Chat 内允许
              </button>
              <button type="button" class="perm-btn tonal" @click="respondPerm('always_allow')">
                本会话始终允许
              </button>
              <button type="button" class="perm-btn danger-ghost" @click="respondPerm('always_deny')">
                本会话始终拒绝
              </button>
            </div>
          </div>
        </div>
      </div>
    </v-dialog>

    <v-dialog
      v-model="askDialog"
      max-width="480"
      persistent
      scrollable
      content-class="ask-dialog-host"
    >
      <div v-if="askReq" class="ask-card">
        <header class="ask-head">
          <p class="dialog-eyebrow">{{ askEyebrow }}</p>
          <h2 class="ask-title" :title="askHeadingFull">{{ askHeading }}</h2>
          <p v-if="askHeadMeta" class="ask-head-meta">{{ askHeadMeta }}</p>
          <div
            v-if="askReq.kind === 'user_choice' && askForkTotal"
            class="ask-fork-steps"
            role="progressbar"
            :aria-valuenow="askForkStep"
            :aria-valuemin="1"
            :aria-valuemax="askForkTotal"
            :aria-label="`第 ${askForkStep}/${askForkTotal} 步`"
          >
            <span
              v-for="n in askForkTotal"
              :key="n"
              class="ask-fork-step-dot"
              :class="{
                done: n < askForkStep,
                current: n === askForkStep,
              }"
            />
          </div>
          <p v-if="askRemainingLabel" class="ask-timeout" :class="{ urgent: askRemainingUrgent }">
            {{ askRemainingLabel }}
          </p>
          <div
            v-if="askRemainingLabel"
            class="ask-countdown-bar"
            :class="{ urgent: askRemainingUrgent }"
            role="progressbar"
            :aria-valuenow="askRemainingPct"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="askRemainingLabel"
          >
            <div class="ask-countdown-bar-fill" :style="{ width: `${askRemainingPct}%` }" />
          </div>
        </header>
        <div class="ask-body">
          <p v-if="askQuestionBody" class="ask-question-body" :title="askQuestionBody">
            {{ askQuestionBody }}
          </p>
          <ul
            v-if="askPriorAnswers.length"
            class="ask-prior"
            aria-label="本链已选"
          >
            <li v-for="(p, i) in askPriorAnswers" :key="i">
              <span class="ask-prior-q" :title="p.question">{{
                ellipsizeMiddle(p.question, 36)
              }}</span>
              <span class="ask-prior-a" :title="p.answer">{{
                ellipsizeMiddle(p.answer, 36)
              }}</span>
            </li>
          </ul>
          <div v-if="askDownloadDetail" class="ask-dl-detail">
            <div class="ask-dl-row">
              <span class="ask-dl-k">文件</span>
              <span class="ask-dl-v" :title="askDownloadDetail.filename">{{
                ellipsizeMiddle(askDownloadDetail.filename, 42)
              }}</span>
            </div>
            <div class="ask-dl-row">
              <span class="ask-dl-k">保存到</span>
              <span class="ask-dl-v" :title="askDownloadDetail.relPath">{{
                ellipsizeMiddle(askDownloadDetail.relPath, 48)
              }}</span>
            </div>
            <div class="ask-dl-row">
              <span class="ask-dl-k">来源</span>
              <span class="ask-dl-v" :title="askDownloadDetail.url">{{
                ellipsizeUrl(askDownloadDetail.url, 52)
              }}</span>
            </div>
            <div v-if="askDownloadDetail.sizeLabel" class="ask-dl-row">
              <span class="ask-dl-k">大小</span>
              <span class="ask-dl-v">{{ askDownloadDetail.sizeLabel }}</span>
            </div>
          </div>
          <div v-else-if="askReq.evidence?.url" class="ask-evidence">
            <div class="ask-evidence-label">当前页面</div>
            <div
              class="ask-evidence-title"
              :title="askReq.evidence.title || askReq.evidence.url"
            >
              {{ ellipsizeMiddle(askReq.evidence.title || askReq.evidence.url, 40) }}
            </div>
            <div class="ask-evidence-url" :title="askReq.evidence.url">
              {{ ellipsizeUrl(askReq.evidence.url, 56) }}
            </div>
          </div>
          <div class="ask-options">
            <button
              v-for="opt in askOptionItems"
              :key="opt.label"
              type="button"
              class="ask-opt"
              :class="{
                primary: askReq.kind === 'continue_rounds' && opt.label.startsWith('再继续'),
                recommended: opt.recommended,
                danger: askReq.kind === 'download_confirm' && opt.label === '拒绝',
              }"
              @click="respondAskOption(opt.label)"
            >
              <span class="ask-opt-main">
                <span class="ask-opt-label">{{ opt.label }}</span>
                <span v-if="opt.recommended" class="ask-opt-badge">推荐</span>
              </span>
              <span v-if="opt.hint" class="ask-opt-hint">{{ opt.hint }}</span>
            </button>
            <label v-if="askReq.allowCustom" class="ask-opt ask-opt-custom">
              <span class="ask-opt-custom-tag">自定义</span>
              <input
                v-model="askCustom"
                class="ask-opt-custom-input"
                type="text"
                placeholder="输入你的决定…"
                @keydown.enter.prevent="respondAskCustom"
              />
              <button
                type="button"
                class="ask-opt-custom-submit"
                :disabled="!askCustom.trim()"
                @click.prevent="respondAskCustom"
              >
                提交
              </button>
            </label>
          </div>
          <div v-if="askReq.kind !== 'download_confirm'" class="ask-footer">
            <button type="button" class="ask-shelve" @click="shelveAsk">
              搁置
            </button>
            <button
              v-if="askReq.kind === 'user_choice'"
              type="button"
              class="ask-deny"
              @click="respondAskDeny"
            >
              拒绝回答
            </button>
          </div>
        </div>
      </div>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="440" persistent>
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
    </v-dialog>

    <v-dialog v-model="closeSessionDialog" max-width="420" persistent>
      <v-card>
        <v-card-title>关闭 Session</v-card-title>
        <v-card-text>
          <p>
            确定关闭
            <strong>Session #{{ closeSessionTarget?.sessionIndex }}</strong>
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
    </v-dialog>

    <v-dialog v-model="quitDialog" max-width="400" persistent>
      <v-card>
        <v-card-title>退出 Navora</v-card-title>
        <v-card-text>确定要退出程序吗？正在运行的 Agent 将被停止。</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="quitting" @click="quitDialog = false">取消</v-btn>
          <v-btn color="error" :loading="quitting" @click="confirmQuit">退出</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <SidebarContextMenu ref="pageCtxMenu">
      <template v-if="pageCtx?.kind === 'chat' || pageCtx?.kind === 'sub'">
        <button type="button" class="sidebar-more-item" role="menuitem" @click="startRenameChat(pageCtx.chat)">
          <font-awesome-icon icon="pen-to-square" />
          <span>修改标题</span>
        </button>
        <button
          v-if="pageCtx.kind === 'chat'"
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          @click="toggleChatPinned(pageCtx.chat)"
        >
          <font-awesome-icon icon="thumbtack" />
          <span>{{ pageCtx.chat.pinned ? '取消置顶' : '置顶' }}</span>
        </button>
        <button type="button" class="sidebar-more-item danger" role="menuitem" @click="askDeleteChat(pageCtx.chat)">
          <font-awesome-icon icon="trash" />
          <span>删除</span>
        </button>
      </template>
      <template v-else-if="pageCtx?.kind === 'msg'">
        <button
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          :disabled="!pageCtx.selected"
          @click="copyText(pageCtx.selected)"
        >
          <font-awesome-icon icon="clipboard-list" />
          <span>复制</span>
        </button>
        <button
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          :disabled="!pageCtx.selected"
          @click="quoteToComposer(pageCtx.selected)"
        >
          <font-awesome-icon icon="pen-to-square" />
          <span>引用到输入框</span>
        </button>
      </template>
      <template v-else-if="pageCtx?.kind === 'composer'">
        <button
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          :disabled="!pageCtx.selected"
          @click="composerCut"
        >
          <font-awesome-icon icon="scissors" />
          <span>剪切</span>
        </button>
        <button
          type="button"
          class="sidebar-more-item"
          role="menuitem"
          :disabled="!pageCtx.selected"
          @click="copyText(pageCtx.selected)"
        >
          <font-awesome-icon icon="clipboard-list" />
          <span>复制</span>
        </button>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="composerPaste">
          <font-awesome-icon icon="paste" />
          <span>粘贴</span>
        </button>
        <button type="button" class="sidebar-more-item" role="menuitem" @click="composerSelectAll">
          <font-awesome-icon icon="check" />
          <span>全选</span>
        </button>
      </template>
    </SidebarContextMenu>

    <Teleport to="body">
      <div
        v-if="chatSearchOpen"
        class="chat-search-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="搜索对话"
        @keydown.esc.prevent="closeChatSearch"
      >
        <div class="chat-search-scrim" @click="closeChatSearch" />
        <div class="chat-search-panel">
          <div class="chat-search-box">
            <font-awesome-icon icon="magnifying-glass" class="chat-search-lead" />
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
              <font-awesome-icon icon="xmark" />
            </button>
          </div>
          <div class="chat-search-results">
            <p v-if="!chatSearchQuery.trim()" class="chat-search-hint">输入关键词开始搜索</p>
            <p v-else-if="!chatSearchHits.length" class="chat-search-hint">没有匹配的对话</p>
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
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="lightbox.src"
        class="media-lightbox"
        role="dialog"
        aria-modal="true"
        tabindex="0"
        @click.self="closeLightbox"
        @keydown.esc.prevent="closeLightbox"
      >
        <button type="button" class="media-lightbox-close" title="关闭" @click="closeLightbox">
          <font-awesome-icon icon="xmark" />
        </button>
        <img :src="lightbox.src" :alt="lightbox.alt" />
        <p v-if="lightbox.alt" class="media-lightbox-cap">{{ lightbox.alt }}</p>
      </div>
    </Teleport>

    <SettingsDialog v-model="settingsOpen" />
    <DocsDialog v-model="docsOpen" />
    <SkillReviewHost />

    <v-snackbar v-model="toast.show" :color="toast.color" timeout="2800" location="bottom">
      {{ toast.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'ChatPage' })
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import { detectPermissionPreset, modesForPreset, type AiProviderConfig, type AppConfig } from '@shared/config'
import {
  followupKey,
  normalizeFollowupList,
  type FollowupSuggestion,
} from '@shared/followups'
import { normalizeProvider, resolveModelName, resolveProvider } from '@shared/model-providers'
import ChatMarkdown from '@/components/ChatMarkdown.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import DocsDialog from '@/components/DocsDialog.vue'
import SkillReviewHost from '@/components/skills/SkillReviewHost.vue'
import CatalogItemCard from '@/components/store/CatalogItemCard.vue'
import ToolCatalogList from '@/components/store/ToolCatalogList.vue'
import { useStoreUi } from '@/composables/useStoreUi'
import { storeErrorText } from '@shared/store'
import BrowserDownloadsMenu from '@/components/BrowserDownloadsMenu.vue'
import WorkspaceFilesPanel from '@/components/sidebar/WorkspaceFilesPanel.vue'
import BrowserResourcesPanel from '@/components/sidebar/BrowserResourcesPanel.vue'
import SidebarContextMenu from '@/components/sidebar/SidebarContextMenu.vue'
import { useMobileLayout } from '@/composables/useMobileLayout'
import {
  extractImagePathFromToolResult,
  resolveWorkspaceMediaUrl,
  revokeAllMediaUrls,
  revokeMediaUrlsForChat,
} from '@/utils/chat-media'
import {
  faviconForUrl,
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
  TOOL_RUN_GROUP_LABEL,
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
const activeId = ref<string | null>(null)
const active = ref<ChatSession | null>(null)
const tree = ref<BrowserTreeSession[]>([])
const windowCounts = ref<Record<string, number>>({})
const draft = ref('')
const maxComposerChars = ref(16000)
/** Local last edit time for draft LWW vs remote. */
const draftTouchedAt = ref(0)
let applyingRemoteDraft = false
let draftSaveTimer: ReturnType<typeof setTimeout> | undefined
let draftSaveInflight: Promise<void> | null = null
const contextRefs = ref<BrowserContextRef[]>([])
const agentRunning = ref(false)
const sending = ref(false)
const retrying = ref(false)
const composerExpanded = ref(false)
const permMenuOpen = ref(false)
const modelMenuOpen = ref(false)
const usageMenuOpen = ref(false)
const settingsPermissions = ref<ChatPermissions | null>(null)
const aiProviders = ref<AiProviderConfig[]>([])
const aiDefaultProviderId = ref('')
const providerKeyOk = ref<Record<string, boolean>>({})
const CONTENT_BUDGET_CHARS = 200_000
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
const draftField = ref<{ focus?: () => void } | null>(null)
const stickToBottom = ref(true)
const showJumpBottom = ref(false)
const toolMediaSrc = ref<Record<string, string>>({})
const lightbox = ref<{ src: string; alt: string }>({ src: '', alt: '' })
const permDialog = ref(false)
const permReq = ref<PermissionRequest | null>(null)
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

/** Expand children when this parent (or one of its subs) is the active chat. */
function isChatBranchExpanded(parentId: string): boolean {
  if (chatBatchMode.value) return false
  if (!subchatCountOf(parentId)) return false
  if (activeId.value === parentId) return true
  const cur = chats.value.find((c) => c.id === activeId.value)
  return Boolean(cur?.kind === 'sub' && cur.parentChatId === parentId)
}

/** Custom left rail scrollbar (native arrows cannot be reliably hidden on Windows). */
const subScrollEls = new Map<string, HTMLElement>()
const subScrollMetrics = ref<
  Record<string, { top: number; thumbH: number; needsBar: boolean }>
>({})

function setSubScrollEl(parentId: string, el: unknown) {
  const node = el instanceof HTMLElement ? el : null
  if (node) {
    subScrollEls.set(parentId, node)
    void nextTick(() => refreshSubScrollMetrics(parentId))
  } else {
    subScrollEls.delete(parentId)
    if (subScrollMetrics.value[parentId]) {
      const next = { ...subScrollMetrics.value }
      delete next[parentId]
      subScrollMetrics.value = next
    }
  }
}

function refreshSubScrollMetrics(parentId: string) {
  const el = subScrollEls.get(parentId)
  if (!el) return
  const { scrollTop, scrollHeight, clientHeight } = el
  const needsBar = scrollHeight > clientHeight + 1
  if (!needsBar) {
    if (subScrollMetrics.value[parentId]?.needsBar) {
      subScrollMetrics.value = {
        ...subScrollMetrics.value,
        [parentId]: { top: 0, thumbH: 0, needsBar: false },
      }
    }
    return
  }
  const thumbH = Math.max(14, Math.round((clientHeight * clientHeight) / scrollHeight))
  const maxTop = Math.max(0, clientHeight - thumbH)
  const range = Math.max(1, scrollHeight - clientHeight)
  const top = Math.round((scrollTop / range) * maxTop)
  const prev = subScrollMetrics.value[parentId]
  if (prev && prev.top === top && prev.thumbH === thumbH && prev.needsBar) return
  subScrollMetrics.value = {
    ...subScrollMetrics.value,
    [parentId]: { top, thumbH, needsBar: true },
  }
}

function onSubListScroll(parentId: string) {
  refreshSubScrollMetrics(parentId)
}

function subScrollNeedsBar(parentId: string): boolean {
  return Boolean(subScrollMetrics.value[parentId]?.needsBar)
}

function subScrollThumbStyle(parentId: string): Record<string, string> {
  const m = subScrollMetrics.value[parentId]
  if (!m?.needsBar) return { opacity: '0' }
  return {
    height: `${m.thumbH}px`,
    transform: `translateY(${m.top}px)`,
  }
}

watch(
  [activeId, () => chats.value.map((c) => `${c.id}:${c.parentChatId || ''}`).join('|')],
  () => {
    void nextTick(() => {
      for (const id of subScrollEls.keys()) refreshSubScrollMetrics(id)
    })
  },
)

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
const quitDialog = ref(false)
const quitting = ref(false)
const exportingChat = ref(false)
const sidebarMoreOpen = ref(false)
const settingsOpen = ref(false)
const docsOpen = ref(false)
const mobileSidebarOpen = ref(false)
const chatSearchOpen = ref(false)
const chatSearchQuery = ref('')
const chatSearchInput = ref<HTMLInputElement | null>(null)
const toast = ref({ show: false, text: '', color: 'error' as string })
const askDialog = ref(false)
const askReq = ref<AgentAskRequest | null>(null)
const askCustom = ref('')
/** Pending asks keyed by chatId — kept when shelved or when ask arrives for a background chat. */
const pendingAsks = ref<Record<string, AgentAskRequest>>({})
/** Absolute expiry time (ms) for each pending ask id */
const askExpiresAtById = ref<Record<string, number>>({})
/** Ask ids the user explicitly shelved — don't auto-reopen on selectChat */
const userShelvedAskIds = ref<Set<string>>(new Set())
const phaseByChat = ref<Record<string, { phase: AgentPhase; detail: string }>>({})

const askOptionItems = computed(() => {
  const req = askReq.value
  if (!req) return []
  if (req.optionItems?.length) return req.optionItems
  return (req.options || []).map((label) => ({ label }))
})

/** One meta line only: kind · chat — no step/rounds stacked here. */
const askEyebrow = computed(() => {
  const req = askReq.value
  if (!req) return ''
  const kind =
    req.kind === 'continue_rounds'
      ? '推理轮数'
      : req.kind === 'download_confirm'
        ? '文件下载'
        : '需要选择'
  const chat = askChatTitle.value.trim()
  if (req.parentChatId && req.subChatTitle) {
    return chat ? `${kind} · 子任务「${req.subChatTitle}」` : `${kind} · 子任务`
  }
  return chat ? `${kind} · ${chat}` : kind
})

const askHeadingFull = computed(() => {
  const req = askReq.value
  if (!req) return ''
  if (req.kind === 'download_confirm') {
    return String(req.question || '是否保存到工作区？').trim()
  }
  if (req.kind === 'user_choice') {
    const forkTitle = req.meta?.forkTitle?.trim()
    if (forkTitle) return forkTitle
  }
  return String(req.question || '').trim()
})

/** First line only; length handled by CSS line-clamp. */
const askHeading = computed(() => {
  const full = askHeadingFull.value
  if (!full) return ''
  return full.split(/\n/)[0]?.trim() || full
})

/** Secondary head meta (rounds etc.) — never duplicates eyebrow or the h2. */
const askHeadMeta = computed(() => {
  const req = askReq.value
  if (!req || req.kind !== 'continue_rounds') return ''
  const used = req.meta?.roundsUsed
  if (!used) return ''
  const extra = req.meta?.continueBy
  return extra ? `已用 ${used} 轮 · 本次建议再加 ${extra}` : `已用 ${used} 轮`
})

/** Question body when h2 is forkTitle / first line only — avoid duplicating the title. */
const askQuestionBody = computed(() => {
  const req = askReq.value
  if (!req) return ''
  const q = String(req.question || '').trim()
  if (!q) return ''
  if (req.kind === 'download_confirm') return ''
  if (req.kind === 'user_choice') {
    const forkTitle = req.meta?.forkTitle?.trim()
    if (forkTitle) {
      if (q === forkTitle) return ''
      // Drop a leading line identical to the fork title.
      const lines = q.split(/\n/).map((s) => s.trim()).filter(Boolean)
      if (lines[0] === forkTitle) return lines.slice(1).join('\n')
      return q
    }
  }
  const lines = q.split(/\n/).map((s) => s.trim()).filter(Boolean)
  if (lines.length <= 1) return ''
  return lines.slice(1).join('\n')
})

const permEyebrow = computed(() => {
  const bits = ['需要授权']
  const chat = String(permChatTitle.value || '').trim()
  if (chat) bits.push(chat)
  return bits.join(' · ')
})

const askDownloadDetail = computed(() => {
  const req = askReq.value
  if (!req || req.kind !== 'download_confirm') return null
  const filename = String(req.meta?.downloadFilename || req.evidence?.title || '').trim()
  const relPath = String(req.meta?.downloadRelPath || '').trim()
  const url = String(req.meta?.downloadUrl || req.evidence?.url || '').trim()
  if (!filename && !relPath && !url) return null
  return {
    filename: filename || 'download',
    relPath: relPath || 'downloads/',
    url: url || '',
    sizeLabel: String(req.meta?.downloadSizeLabel || '').trim() || undefined,
  }
})

function ellipsizeMiddle(raw: string, max = 40): string {
  const s = String(raw || '').trim()
  if (!s || s.length <= max) return s
  const keep = Math.max(6, Math.floor((max - 1) / 2))
  return `${s.slice(0, keep)}…${s.slice(-keep)}`
}

function ellipsizeUrl(raw: string, max = 52): string {
  const s = String(raw || '').trim()
  if (!s || s.length <= max) return s
  try {
    const u = new URL(s)
    const host = u.host.replace(/^www\./i, '')
    const path = `${u.pathname || ''}${u.search || ''}`
    const compact = path && path !== '/' ? `${host}${path}` : host
    if (compact.length <= max) return compact
    const hostKeep = Math.min(host.length, Math.floor(max * 0.4))
    const rest = max - hostKeep - 1
    return `${host.slice(0, hostKeep)}…${compact.slice(-rest)}`
  } catch {
    return ellipsizeMiddle(s, max)
  }
}

const askChatTitle = computed(() => {
  if (!askReq.value) return ''
  const c = chats.value.find((x) => x.id === askReq.value!.chatId)
  if (c?.kind === 'sub') {
    return c.title || askReq.value.subChatTitle || askReq.value.chatId
  }
  return c?.title || askReq.value.subChatTitle || askReq.value.chatId
})

const askForkStep = computed(() => {
  const s = askReq.value?.meta?.step
  return typeof s === 'number' && s >= 1 ? Math.floor(s) : 0
})

const askForkTotal = computed(() => {
  const t = askReq.value?.meta?.totalSteps
  return typeof t === 'number' && t >= 1 ? Math.floor(t) : 0
})

const askPriorAnswers = computed(() => {
  const list = askReq.value?.meta?.priorAnswers
  return Array.isArray(list) ? list : []
})

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

const askRemainingLabel = computed(() => {
  const id = askReq.value?.id
  if (!id) return ''
  return formatAskRemaining(askExpiresAtById.value[id])
})

const askRemainingUrgent = computed(() => {
  const id = askReq.value?.id
  if (!id) return false
  const expires = askExpiresAtById.value[id]
  if (!expires) return false
  void nowTick.value
  return expires - Date.now() <= 15000
})

const askRemainingPct = computed(() =>
  askRemainingPctOf(askReq.value?.id, askReq.value?.timeoutMs),
)

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
  const ms = typeof req.timeoutMs === 'number' ? req.timeoutMs : 60000
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
  if (!req) return '待决策'
  const step = req.meta?.step
  const total = req.meta?.totalSteps
  if (typeof step === 'number' && step >= 1 && typeof total === 'number' && total >= 1) {
    return `待决策 ${Math.floor(step)}/${Math.floor(total)}`
  }
  if (req.kind === 'continue_rounds') return '待决策 · 轮数'
  if (req.kind === 'download_confirm') return '待决策 · 被动下载'
  return '待决策'
}

const activePendingAsk = computed(() => {
  const id = activeId.value
  if (!id) return null
  return pendingAsks.value[id] || null
})

/** Show in-chat card / dock when there is a pending ask and the dialog is not already open for it. */
const showInlinePendingAsk = computed(() => {
  const req = activePendingAsk.value
  if (!req) return false
  if (askDialog.value && askReq.value?.id === req.id) return false
  return true
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

const inlineAskCardEl = ref<HTMLElement | null>(null)

const permChatTitle = computed(() => {
  if (!permReq.value) return ''
  const c = chats.value.find((x) => x.id === permReq.value!.chatId)
  return c?.title || permReq.value.chatId
})

const permExpiresAt = ref(0)
const permTimeoutTotalMs = ref(0)

function trackPermExpiry(req: PermissionRequest) {
  const ms = typeof req.timeoutMs === 'number' ? req.timeoutMs : 120000
  if (!(ms > 0)) {
    clearPermExpiry()
    return
  }
  permTimeoutTotalMs.value = ms
  permExpiresAt.value = Date.now() + ms
}

function clearPermExpiry() {
  permExpiresAt.value = 0
  permTimeoutTotalMs.value = 0
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
  toast.value = { show: true, text, color }
}
let unsubTree: (() => void) | undefined
let unsubAgent: (() => void) | undefined
let unsubChats: (() => void) | undefined
let unsubConfig: (() => void) | undefined
let unsubPerm: (() => void) | undefined
let unsubPermCancel: (() => void) | undefined
let unsubAsk: (() => void) | undefined
let unsubAskCancel: (() => void) | undefined
let dragDepth = 0
let tickTimer: ReturnType<typeof setInterval> | undefined
let resizeObserver: ResizeObserver | undefined
let onWinResize: (() => void) | undefined

const suggestions = [
  '用权威天气站查一下北京今天天气和穿衣建议',
  '搜索今日热点新闻，用三条要点概括',
  '帮我对比两家外卖平台同款套餐的价格与配送时长',
  '打开高铁/机票查询页，查一下周末去上海的可选班次概况',
  '去招聘网站搜「前端」岗位，归纳薪资区间与常见要求',
  '打开 GitHub Trending，挑 3 个值得关注的开源项目并简述',
  '帮我做一份本周买菜清单，并写进工作区文件',
  '截一张当前桌面，帮我标出可能要处理的窗口',
  '新建一个浏览器 Session，打开待办网站帮我理清任务',
  '下载一份公开 PDF 到工作区并提炼摘要',
  '打开邮箱网页版（勿登录），说明登录后怎么快速清空促销信',
  '用浏览器查最近油价/电价政策变化，给结论和来源',
  '打开知乎/小红书搜「周末短途」，整理 5 个可执行点子',
  '访问医院/政务预约说明页，总结挂号或办事步骤',
  '列出当前浏览器 Session 与窗口，清理不用的资源',
  '打开商品比价页，帮我判断这款耳机值不值得买',
  '查一下国家图书馆开放时间与网上借阅/预约流程',
  '用 shell 在工作区建个 notes 文件夹，并写一份今日备忘',
]

const suggestionRows = computed(() => {
  const mid = Math.ceil(suggestions.length / 2)
  return [suggestions.slice(0, mid), suggestions.slice(mid)]
})

const showFollowupSuggestions = ref(true)
const showReadPages = ref(true)
const showRunLogs = ref(true)
const collapseToolRuns = ref(true)
const collapseRunLogs = ref(true)
const readPagesPanelOpen = ref(false)
const readPagesPanelList = ref<AnswerSource[]>([])
const readPagesPanelFromId = ref<string | null>(null)
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
const expandedRuns = ref<Record<string, boolean>>({})
const expandedReasoning = ref<Record<string, boolean>>({})
const liveReasoningByChat = ref<
  Record<string, { content: string; status: 'live' | 'done'; round?: number }>
>({})
const liveReasoningForced = ref<Record<string, boolean | undefined>>({})
const liveReasoningBodyEl = ref<HTMLElement | null>(null)
const logOverflowById = ref<Record<string, boolean>>({})
const logMeasureEls = new Map<string, HTMLElement>()
const logResizeObservers = new Map<string, ResizeObserver>()

type MessageBlock =
  | { type: 'chat'; key: string; message: ChatMessage }
  | { type: 'tool'; key: string; message: ChatMessage }
  | { type: 'log'; key: string; message: ChatMessage }
  | { type: 'run'; key: string; items: ChatMessage[] }

const messageBlocks = computed((): MessageBlock[] => {
  const msgs = active.value?.messages || []
  const blocks: MessageBlock[] = []

  const pushLogOrFold = (m: ChatMessage, logBuf: ChatMessage[], flushLogs: () => void) => {
    if (!showRunLogs.value && !isErrorRunLog(m)) return
    if (collapseRunLogs.value && showRunLogs.value) {
      logBuf.push(m)
      return
    }
    flushLogs()
    blocks.push({ type: 'log', key: m.id, message: m })
  }

  // Tools expanded: optionally fold consecutive logs only.
  if (!collapseToolRuns.value) {
    let logBuf: ChatMessage[] = []
    const flushLogs = () => {
      if (!logBuf.length) return
      if (logBuf.length === 1) {
        blocks.push({ type: 'log', key: logBuf[0].id, message: logBuf[0] })
      } else {
        blocks.push({
          type: 'run',
          key: `run:${logBuf[0].id}`,
          items: logBuf,
        })
      }
      logBuf = []
    }
    for (const m of msgs) {
      if (m.role === 'log') {
        pushLogOrFold(m, logBuf, flushLogs)
        continue
      }
      flushLogs()
      if (m.role === 'tool') {
        blocks.push({ type: 'tool', key: m.id, message: m })
        continue
      }
      blocks.push({ type: 'chat', key: m.id, message: m })
    }
    flushLogs()
    return blocks
  }

  // Tools collapsed: logs always join the same run summary (no separate log-fold switch).
  let runBuf: ChatMessage[] = []
  const flushRun = () => {
    if (!runBuf.length) return
    blocks.push({
      type: 'run',
      key: `run:${runBuf[0].id}`,
      items: runBuf,
    })
    runBuf = []
  }

  for (const m of msgs) {
    if (m.role === 'log') {
      if (!showRunLogs.value && !isErrorRunLog(m)) continue
      runBuf.push(m)
      continue
    }
    if (m.role === 'tool') {
      // Keep subchat orchestration tools as standalone cards (not folded into run groups).
      const toolName = String(m.meta?.toolName || '')
      if (
        toolName === 'agent_spawn_subchat' ||
        toolName === 'agent_await_subchats' ||
        toolName === 'agent_subchat_status'
      ) {
        flushRun()
        blocks.push({ type: 'tool', key: m.id, message: m })
        continue
      }
      runBuf.push(m)
      continue
    }
    flushRun()
    blocks.push({ type: 'chat', key: m.id, message: m })
  }
  flushRun()
  return blocks
})

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

async function refreshAiProviders(cfg?: AppConfig | null) {
  try {
    const c = cfg ?? (await window.navora?.config.get())
    if (!c?.ai) return
    aiProviders.value = (c.ai.providers || []).map((p) =>
      normalizeProvider({ ...p, models: [...(p.models || [])] }),
    )
    aiDefaultProviderId.value = c.ai.default_provider || c.ai.providers?.[0]?.id || ''
    await refreshProviderKeyFlags()
  } catch {
    /* ignore */
  }
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
  if (draft.value.length > maxComposerChars.value) {
    draft.value = draft.value.slice(0, maxComposerChars.value)
  }
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

const canSend = computed(() => Boolean(draft.value.trim() || contextRefs.value.length))
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

const chatModelLabel = computed(() => chatModelName.value || '模型')

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
    providerLabel: string
    hasKey: boolean
  }[] = []
  for (const raw of aiProviders.value) {
    const p = normalizeProvider({ ...raw, models: [...(raw.models || [])] })
    const models = p.models.length ? p.models : [p.model]
    for (const m of models) {
      out.push({
        key: `${p.id}::${m}`,
        providerId: p.id,
        model: m,
        providerLabel: p.label || p.id,
        hasKey: providerKeyOk.value[p.id] === true,
      })
    }
  }
  return out
})

const usageChars = computed(() =>
  (active.value?.messages || []).reduce((n, m) => n + (m.content?.length || 0), 0),
)
const usageTokensEst = computed(() => Math.max(0, Math.ceil(usageChars.value / 2)))
const usageRatio = computed(() =>
  Math.min(1, usageChars.value / CONTENT_BUDGET_CHARS),
)
const usagePctLabel = computed(() => `${Math.round(usageRatio.value * 1000) / 10}%`)
const USAGE_RING_LEN = 2 * Math.PI * 14
const usageDash = computed(
  () => `${(usageRatio.value * USAGE_RING_LEN).toFixed(2)} ${USAGE_RING_LEN.toFixed(2)}`,
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
  const modes =
    preset === 'custom'
      ? { ...chatPermissions.value.modes }
      : modesForPreset(preset)
  try {
    const chat = await window.navora.chats.setPermissions(activeId.value, { preset, modes })
    if (chat) {
      active.value = chat
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
  if (!window.navora || !activeId.value || agentRunning.value) return
  try {
    const chat = await window.navora.chats.setProvider(activeId.value, providerId, model)
    if (chat) {
      active.value = chat
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
    modelMenuOpen.value = false
  }
}

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

/** Stay open for the whole run unless the user folds it. Hidden when run clears. */
const liveReasoningOpen = computed(() => {
  const id = activeId.value
  if (!id || !liveReasoningText.value) return false
  const forced = liveReasoningForced.value[id]
  if (forced !== undefined) return forced
  return true
})

function toggleLiveReasoning() {
  const id = activeId.value
  if (!id || !liveReasoningText.value) return
  liveReasoningForced.value = {
    ...liveReasoningForced.value,
    [id]: !liveReasoningOpen.value,
  }
}

function messageReasoning(m: ChatMessage): string {
  if (m.role !== 'assistant') return ''
  const raw = m.meta?.reasoning
  return typeof raw === 'string' ? raw.trim() : ''
}

function isReasoningExpanded(id: string): boolean {
  return expandedReasoning.value[id] === true
}

function toggleReasoning(id: string) {
  expandedReasoning.value = {
    ...expandedReasoning.value,
    [id]: !expandedReasoning.value[id],
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
      const snippet = String(item.snippet || '').trim()
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
  void window.navora?.app.openExternal(url)
}

function friendlyToolName(name: string) {
  const map: Record<string, string> = {
    agent_ask_user: '询问你',
    agent_spawn_subchat: '启动子对话',
    agent_await_subchats: '等待子对话',
    agent_subchat_status: '子对话状态',
    datetime_now: '获取时间',
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

/** Show tool id only when it adds info beyond the friendly title. */
function toolHeadRaw(m: ChatMessage): string {
  const raw = String(m.meta?.toolName || '').trim()
  if (!raw) return ''
  if (raw === 'shell_exec' && toolHeadTitle(m)) return ''
  const title = toolHeadTitle(m)
  if (title && title === raw) return ''
  return raw
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

function formatJson(v: unknown) {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function toolStatusClass(m: ChatMessage) {
  if (m.role !== 'tool') return ''
  return `tool-${effectiveToolStatus(m)}`
}

function effectiveToolStatus(m: ChatMessage): string {
  const status = String(m.meta?.status || 'done')
  // While Agent is stopping, keep unfinished tools as aborted — never fake them as
  // done/error, or the collapsed run title picks up the wrong tone.
  if (status === 'running' && !agentRunning.value) return 'aborted'
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
      meta = { ...meta, partial: false }
      changed = true
    }
    if (m.role === 'tool' && meta?.status === 'running') {
      // Prefer aborted for leftover running tools when the run ends (esp. user stop).
      // Successful runs normally finish tools as done before status flips.
      meta = { ...meta, status: 'aborted' }
      if (content === '执行中…' || !String(content || '').trim()) content = '用户终止'
      changed = true
    }
    if (meta === m.meta && content === m.content) return m
    return { ...m, content, meta }
  })
  if (changed) active.value = { ...active.value, messages: next }
}

function toggleTool(id: string) {
  expandedTools.value = { ...expandedTools.value, [id]: !expandedTools.value[id] }
}

function isRunExpanded(key: string): boolean {
  return expandedRuns.value[key] === true
}

function toggleRun(key: string) {
  expandedRuns.value = { ...expandedRuns.value, [key]: !expandedRuns.value[key] }
}

function expandRunContaining(messageId: string) {
  if (!collapseToolRuns.value) return
  for (const b of messageBlocks.value) {
    if (b.type === 'run' && b.items.some((m) => m.id === messageId)) {
      expandedRuns.value = { ...expandedRuns.value, [b.key]: true }
      return
    }
  }
}

function runGroupTools(items: ChatMessage[]): ChatMessage[] {
  return items.filter((m) => m.role === 'tool')
}

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

function runGroupLive(items: ChatMessage[]): boolean {
  if (!agentRunning.value || !items.length) return false
  if (items.some((m) => m.role === 'tool' && effectiveToolStatus(m) === 'running')) return true
  const last = messageBlocks.value[messageBlocks.value.length - 1]
  return Boolean(last && last.type === 'run' && last.key === `run:${items[0].id}`)
}

function isStopRunLog(m: ChatMessage): boolean {
  return m.role === 'log' && String(m.meta?.kind || '') === 'agent_stop'
}

function runGroupWasAborted(items: ChatMessage[]): boolean {
  if (items.some((m) => isStopRunLog(m))) return true
  return runGroupTools(items).some((m) => effectiveToolStatus(m) === 'aborted')
}

function runGroupHasError(items: ChatMessage[]): boolean {
  if (runGroupTools(items).some((m) => effectiveToolStatus(m) === 'error')) return true
  return items.some((m) => isErrorRunLog(m))
}

function runGroupErrorSummary(items: ChatMessage[]): string | null {
  const errLog = [...items].reverse().find((m) => isErrorRunLog(m))
  if (!errLog) return null
  const summary = String(errLog.meta?.summary || '').trim()
  if (summary && summary !== 'Agent 出错') return summary
  const full = logFullText(errLog).trim()
  const line = full.split(/\r?\n/).find((l) => l.trim() && l.trim() !== 'Agent 出错')
  return line?.trim() || summary || '执行失败'
}

function runGroupCountLabel(items: ChatMessage[]): string {
  const toolCount = runGroupTools(items).length
  if (toolCount) return `${toolCount} 个工具`
  const logCount = items.filter((m) => m.role === 'log').length
  return logCount ? `${logCount} 条日志` : '操作记录'
}

function runGroupSummary(items: ChatMessage[]): string {
  const tools = runGroupTools(items)

  if (runGroupLive(items)) {
    const running = tools.find((m) => effectiveToolStatus(m) === 'running')
    if (running) {
      const disp = toolDisplay(running)
      const name = friendlyToolName(String(running.meta?.toolName || 'tool'))
      const step = tools.indexOf(running) + 1
      return `第 ${step}/${tools.length || 1} 步 · ${disp.label} · ${name}…`
    }
    if (tools.length) return `已完成 ${tools.length} 步 · 继续中…`
    return '执行中…'
  }

  const base = runGroupCountLabel(items)
  // User stop must not be framed as tool failure in the collapsed title.
  if (runGroupWasAborted(items) && !runGroupHasError(items)) {
    return `${base} · 用户终止`
  }
  if (runGroupHasError(items)) {
    const errHint = runGroupErrorSummary(items)
    return errHint ? `${base} · ${errHint}` : `${base} · 有失败`
  }
  return base
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
        ? `子任务待决策${badge ? `：${badge}` : ''}`
        : badge
          ? `有待决策：${badge}`
          : '有待决策，点击打开',
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

function spawnStatusOf(m: ChatMessage): string {
  if (isSpawnSubchatDeleted(m)) return 'deleted'
  const fromMeta = String(m.meta?.spawnStatus || '').trim()
  if (fromMeta) return fromMeta
  const result = m.meta?.result
  if (result && typeof result === 'object' && 'status' in result) {
    return String((result as { status?: string }).status || '').trim() || 'running'
  }
  return 'running'
}

function spawnStatusLabel(m: ChatMessage): string {
  const s = spawnStatusOf(m)
  if (s === 'deleted') return '已删除'
  if (s === 'done') return '已完成'
  if (s === 'failed') return '失败'
  if (s === 'cancelled') return '已取消'
  return '运行中'
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
  return spawnGoalOf(m) || '子对话'
}

async function openSubchatFromTool(m: ChatMessage) {
  const id = spawnSubChatId(m)
  if (!id || isSpawnSubchatDeleted(m)) return
  await selectChat(id)
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
      settingsOpen.value = true
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

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString()
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
    return new Date(ts).toLocaleDateString()
  } catch {
    return ''
  }
}

function onMessagesScroll() {
  const el = msgBox.value
  if (!el) return
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  stickToBottom.value = dist < 80
  showJumpBottom.value = !stickToBottom.value && el.scrollHeight > el.clientHeight + 40
}

async function scrollMessages(force = false) {
  await nextTick()
  if (!msgBox.value) return
  if (!force && !stickToBottom.value) {
    showJumpBottom.value = true
    return
  }
  msgBox.value.scrollTop = msgBox.value.scrollHeight
  stickToBottom.value = true
  showJumpBottom.value = false
}

function jumpToBottom() {
  stickToBottom.value = true
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

function clampDraftText(text: string): string {
  const max = maxComposerChars.value
  if (text.length <= max) return text
  return text.slice(0, max)
}

function applyDraftLocally(text: string, touchedAt: number) {
  applyingRemoteDraft = true
  draft.value = clampDraftText(text)
  draftTouchedAt.value = touchedAt
  void nextTick(() => {
    applyingRemoteDraft = false
  })
}

async function persistDraftNow(chatId: string | null | undefined, text: string, touchedAt: number) {
  if (!window.navora?.chats.setDraft || !chatId) return
  const body = clampDraftText(text)
  try {
    await window.navora.chats.setDraft(chatId, body, {
      updatedAt: touchedAt,
      maxChars: maxComposerChars.value,
    })
  } catch (e) {
    console.warn('[draft] save failed', e)
  }
}

function scheduleDraftSave() {
  if (applyingRemoteDraft) return
  const chatId = activeId.value
  if (!chatId) return
  draftTouchedAt.value = Date.now()
  if (draft.value.length > maxComposerChars.value) {
    draft.value = draft.value.slice(0, maxComposerChars.value)
  }
  clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    const id = activeId.value
    if (!id) return
    draftSaveInflight = persistDraftNow(id, draft.value, draftTouchedAt.value).finally(() => {
      draftSaveInflight = null
    })
  }, 350)
}

async function flushDraftSave(chatId?: string | null) {
  clearTimeout(draftSaveTimer)
  if (draftSaveInflight) {
    try {
      await draftSaveInflight
    } catch {
      /* ignore */
    }
  }
  const id = chatId ?? activeId.value
  if (!id || applyingRemoteDraft) return
  await persistDraftNow(id, draft.value, draftTouchedAt.value || Date.now())
}

watch(draft, () => {
  if (applyingRemoteDraft) return
  scheduleDraftSave()
})

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
  void window.navora?.app.openExternal(href)
}

function onComposerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (agentRunning.value) {
      e.preventDefault()
      void stopAgent()
      return
    }
    if (contextRefs.value.length) {
      e.preventDefault()
      contextRefs.value = []
    }
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    if (!agentRunning.value) void send()
  }
}

function refKey(r: BrowserContextRef) {
  return r.kind === 'window' ? `w:${r.windowId}` : `s:${r.sessionId}`
}

/** Strip Vue proxies so refs survive Electron IPC structured clone. */
function plainContextRefs(list: BrowserContextRef[]): BrowserContextRef[] {
  return list.map((r) => {
    const out: BrowserContextRef = {
      kind: r.kind,
      sessionId: String(r.sessionId || ''),
      label: String(r.label || ''),
    }
    if (r.windowId) out.windowId = String(r.windowId)
    if (r.url) out.url = String(r.url)
    if (typeof r.sessionIndex === 'number' && Number.isFinite(r.sessionIndex)) {
      out.sessionIndex = r.sessionIndex
    }
    return out
  })
}

function chipLabel(r: BrowserContextRef) {
  return r.kind === 'window' ? `@窗口 ${r.label}` : `@Session ${r.label}`
}

function addRef(ref: BrowserContextRef) {
  if (contextRefs.value.some((x) => refKey(x) === refKey(ref))) return
  contextRefs.value = [...contextRefs.value, ref]
}

function removeRef(ref: BrowserContextRef) {
  contextRefs.value = contextRefs.value.filter((x) => refKey(x) !== refKey(ref))
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

async function refreshList() {
  if (!window.navora) return
  chats.value = await window.navora.chats.list()
  windowCounts.value = await window.navora.browser.windowCounts()
  if (!activeId.value && chats.value.length) {
    const firstMain = chats.value.find((c) => c.kind !== 'sub') || chats.value[0]
    await selectChat(firstMain.id)
  }
}

async function selectChat(id: string) {
  if (!window.navora) return
  const prev = activeId.value
  if (prev && prev !== id) {
    await flushDraftSave(prev)
  }
  // Leaving a chat with an open ask — keep pending, don't mark as user-shelved.
  if (askReq.value && askReq.value.chatId !== id) {
    rememberPendingAsk(askReq.value)
    askDialog.value = false
    askReq.value = null
    askCustom.value = ''
  }
  if (prev && prev !== id) revokeMediaUrlsForChat(prev)
  toolMediaSrc.value = {}
  expandedRuns.value = {}
  closeLightbox()
  closeReadPagesPanel()
  activeId.value = id
  active.value = await window.navora.chats.get(id)
  tree.value = await window.navora.browser.tree(id)
  const running = await window.navora.agent.isRunning(id)
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
  contextRefs.value = []
  applyDraftLocally(active.value?.draft || '', active.value?.draftUpdatedAt || 0)
  stickToBottom.value = true
  composerExpanded.value = false
  void hydrateActiveToolMedia()
  showJumpBottom.value = false
  followupSuggestions.value = followupsByChat.value[id] || []
  await scrollMessages(true)
  focusComposer()
  const pending = pendingAsks.value[id]
  if (pending && !userShelvedAskIds.value.has(pending.id)) {
    openAskDialog(pending)
  }
  closeMobileSidebar()
}

async function createChat() {
  if (!window.navora) return
  try {
    const c = await window.navora.chats.create()
    await refreshList()
    await selectChat(c.id)
  } catch (e) {
    console.error(e)
    showToast(e instanceof Error ? e.message : '创建 Chat 失败')
  }
}

function askDeleteChat(c: ChatSession) {
  closeChatSwipe()
  chatMoreOpenId.value = null
  deleteBatchIds.value = null
  deleteTarget.value = c
  deleteDialog.value = true
}

function onChatMoreOpen(chatId: string, open: boolean) {
  if (open) chatMoreOpenId.value = chatId
  else if (chatMoreOpenId.value === chatId) chatMoreOpenId.value = null
}

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
    contextRefs.value = contextRefs.value.filter((r) => r.sessionId !== sessionId)
    if (activeId.value) {
      tree.value = await window.navora.browser.tree(activeId.value)
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
  if (!window.navora?.app.quit || quitting.value) return
  quitting.value = true
  try {
    await window.navora.app.quit()
  } catch (e) {
    console.error(e)
    quitting.value = false
    showToast(e instanceof Error ? e.message : '退出失败')
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

function onMoreDocs() {
  sidebarMoreOpen.value = false
  docsOpen.value = true
}

function onMoreExport() {
  sidebarMoreOpen.value = false
  void exportActiveChat()
}

function onMoreQuit() {
  sidebarMoreOpen.value = false
  quitDialog.value = true
}

async function exportActiveChat() {
  if (!window.navora || !activeId.value || exportingChat.value) return
  exportingChat.value = true
  try {
    const chat = (await window.navora.chats.get(activeId.value)) || active.value
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
    showToast('对话已导出', 'success')
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
  if (!q) return []
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
  return hits
})

function openChatSearch() {
  chatSearchQuery.value = ''
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
  | { kind: 'chat'; chat: ChatSession }
  | { kind: 'sub'; chat: ChatSession }
  | { kind: 'msg'; selected: string }
  | { kind: 'composer'; selected: string; start: number; end: number }

const pageCtx = ref<PageCtx | null>(null)
const pageCtxMenu = ref<{ show: (e: MouseEvent) => void } | null>(null)

function composerTextarea(): HTMLTextAreaElement | null {
  const field = draftField.value as unknown as { $el?: HTMLElement } | null
  return (field?.$el?.querySelector?.('textarea') as HTMLTextAreaElement | undefined) || null
}

function onChatItemContext(e: MouseEvent, c: ChatSession) {
  if (chatBatchMode.value) return
  pageCtx.value = { kind: c.kind === 'sub' ? 'sub' : 'chat', chat: c }
  pageCtxMenu.value?.show(e)
}

function onMessagesContext(e: MouseEvent) {
  const selected = String(window.getSelection?.()?.toString() || '').trim()
  pageCtx.value = { kind: 'msg', selected }
  pageCtxMenu.value?.show(e)
}

function onComposerContext(e: MouseEvent) {
  const el = composerTextarea()
  const start = el?.selectionStart ?? 0
  const end = el?.selectionEnd ?? 0
  const selected = el && end > start ? el.value.slice(start, end) : ''
  pageCtx.value = { kind: 'composer', selected, start, end }
  pageCtxMenu.value?.show(e)
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
  const cur = draft.value.trimEnd()
  applyDraftLocally(clampDraftText(cur ? `${cur}\n\n${quoted}\n` : `${quoted}\n`), Date.now())
  scheduleDraftSave()
  focusComposer()
}

function replaceComposerRange(start: number, end: number, insert: string) {
  const el = composerTextarea()
  const src = el?.value ?? draft.value
  const next = clampDraftText(`${src.slice(0, start)}${insert}${src.slice(end)}`)
  applyDraftLocally(next, Date.now())
  scheduleDraftSave()
  void nextTick(() => {
    const box = composerTextarea()
    if (!box) return
    const pos = Math.min(start + insert.length, box.value.length)
    box.focus()
    box.setSelectionRange(pos, pos)
  })
}

function composerCut() {
  const ctx = pageCtx.value
  if (ctx?.kind !== 'composer' || !ctx.selected) return
  void copyText(ctx.selected)
  replaceComposerRange(ctx.start, ctx.end, '')
}

async function composerPaste() {
  const ctx = pageCtx.value
  if (ctx?.kind !== 'composer') return
  try {
    const text = await navigator.clipboard.readText()
    replaceComposerRange(ctx.start, ctx.end, text)
  } catch {
    showToast('无法读取剪贴板')
  }
}

function composerSelectAll() {
  const el = composerTextarea()
  if (!el) return
  el.focus()
  el.select()
}

async function openRemoteWindow(windowId: string) {
  await router.push(`/remote/${encodeURIComponent(windowId)}`)
}

async function send() {
  const text = draft.value.trim()
  const refs = plainContextRefs(contextRefs.value)
  if ((!text && !refs.length) || !activeId.value || !window.navora || agentRunning.value || sending.value) {
    return
  }
  if (text.length > maxComposerChars.value) {
    showToast(`输入超过上限（${maxComposerChars.value} 字）`, 'warning')
    return
  }
  sending.value = true
  const chatId = activeId.value
  applyDraftLocally('', Date.now())
  contextRefs.value = []
  if (composerExpanded.value) composerExpanded.value = false
  stickToBottom.value = true
  if (chatId) clearFollowups(chatId)
  clearChatError(chatId)
  try {
    active.value = await window.navora.agent.run(chatId, {
      content: text,
      refs,
    })
    const running = await window.navora.agent.isRunning(chatId)
    setRunning(chatId, running)
    if (running) {
      phase.value = 'thinking'
      phaseDetail.value = '正在理解任务…'
    }
    await refreshList()
    await scrollMessages(true)
  } catch (e) {
    console.error(e)
    applyDraftLocally(text, Date.now())
    scheduleDraftSave()
    contextRefs.value = refs
    if (chatId) setRunning(chatId, false)
    const raw = e instanceof Error ? e.message : '发送失败，请重试'
    if (chatId) rememberChatError(chatId, raw)
    const formatted = formatAgentError(raw)
    showToast(formatted.message, formatted.code === 'api_key_missing' ? 'warning' : 'error')
  } finally {
    sending.value = false
    focusComposer()
  }
}

async function retryLast() {
  const chatId = activeId.value
  if (!chatId || !window.navora || agentRunning.value || sending.value || retrying.value) return
  retrying.value = true
  clearChatError(chatId)
  clearFollowups(chatId)
  stickToBottom.value = true
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
  if (!window.navora || !permReq.value) return
  await window.navora.permission.respond(permReq.value.id, decision)
  permDialog.value = false
  permReq.value = null
  clearPermExpiry()
}

async function respondAskOption(opt: string) {
  if (!window.navora || !askReq.value) return
  const id = askReq.value.id
  const chatId = askReq.value.chatId
  clearPendingAsk(chatId, id)
  askDialog.value = false
  askReq.value = null
  askCustom.value = ''
  const ok = await window.navora.agent.respondAsk(id, { answer: opt, source: 'option' })
  if (!ok) showToast('选择未送达（可能已超时）', 'warning')
}

async function respondAskCustom() {
  if (!window.navora || !askReq.value) return
  const text = askCustom.value.trim()
  if (!text) return
  const id = askReq.value.id
  const chatId = askReq.value.chatId
  clearPendingAsk(chatId, id)
  askDialog.value = false
  askReq.value = null
  askCustom.value = ''
  const ok = await window.navora.agent.respondAsk(id, { answer: text, source: 'custom' })
  if (!ok) showToast('选择未送达（可能已超时）', 'warning')
}

async function respondAskDeny() {
  if (!window.navora || !askReq.value) return
  const id = askReq.value.id
  const chatId = askReq.value.chatId
  clearPendingAsk(chatId, id)
  askDialog.value = false
  askReq.value = null
  askCustom.value = ''
  const ok = await window.navora.agent.respondAsk(id, { answer: '', source: 'deny' })
  if (!ok) showToast('操作未送达（可能已超时）', 'warning')
}

/** Close dialog but keep the ask pending for later (sidebar + in-chat card). */
function shelveAsk() {
  const req = askReq.value
  if (req) {
    rememberPendingAsk(req)
    const shelved = new Set(userShelvedAskIds.value)
    shelved.add(req.id)
    userShelvedAskIds.value = shelved
  }
  askDialog.value = false
  askReq.value = null
  askCustom.value = ''
  void nextTick(async () => {
    await scrollMessages(true)
    inlineAskCardEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function openActivePendingAsk() {
  const req = activePendingAsk.value
  if (!req) return
  const shelved = new Set(userShelvedAskIds.value)
  shelved.delete(req.id)
  userShelvedAskIds.value = shelved
  openAskDialog(req)
}

function rememberPendingAsk(req: AgentAskRequest) {
  trackAskExpiry(req)
  pendingAsks.value = { ...pendingAsks.value, [req.chatId]: req }
}

function clearPendingAsk(chatId: string, id?: string) {
  const cur = pendingAsks.value[chatId]
  if (!cur) return
  if (id && cur.id !== id) return
  clearAskExpiry(cur.id)
  const next = { ...pendingAsks.value }
  delete next[chatId]
  pendingAsks.value = next
}

function clearPendingAskById(id: string) {
  for (const [chatId, req] of Object.entries(pendingAsks.value)) {
    if (req.id === id) {
      clearPendingAsk(chatId, id)
      return
    }
  }
  clearAskExpiry(id)
}

function openAskDialog(req: AgentAskRequest) {
  trackAskExpiry(req)
  rememberPendingAsk(req)
  askReq.value = req
  askCustom.value = ''
  askDialog.value = true
  if (req.chatId === activeId.value) {
    phase.value = 'awaiting_user'
    phaseDetail.value = req.question.slice(0, 80)
  }
  phaseByChat.value = {
    ...phaseByChat.value,
    [req.chatId]: { phase: 'awaiting_user', detail: req.question.slice(0, 80) },
  }
}

async function openPendingAsk(chatId: string) {
  const req = pendingAskForSidebar(chatId)
  if (!req) return
  const shelved = new Set(userShelvedAskIds.value)
  shelved.delete(req.id)
  userShelvedAskIds.value = shelved
  // Stay on the sidebar chat (often the parent); answering is keyed by ask id.
  if (activeId.value !== chatId) await selectChat(chatId)
  openAskDialog(req)
}

function closeAskUi(id?: string) {
  if (id && askReq.value && askReq.value.id !== id) return
  askDialog.value = false
  askReq.value = null
  askCustom.value = ''
}

watch(activeId, async (id) => {
  if (id) {
    tree.value = (await window.navora?.browser.tree(id)) || []
    agentRunning.value = (await window.navora?.agent.isRunning(id)) || false
  }
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
watch(modelMenuOpen, (open) => {
  if (open) void refreshAiProviders()
})

watch(agentRunning, (running, wasRunning) => {
  if (wasRunning && !running) void refreshAiProviders()
})

watch(isMobileLayout, (mobile) => {
  if (!mobile) closeChatSwipe()
})

watch(
  () => route.query.settings,
  (v) => {
    if (v !== '1' && v !== 'true') return
    settingsOpen.value = true
    const q = { ...route.query }
    delete q.settings
    void router.replace({ path: route.path || '/', query: q })
  },
  { immediate: true },
)

onMounted(async () => {
  if (!window.navora) {
    console.warn('Navora API unavailable (open via Electron)')
    return
  }
  unsubTree = window.navora.browser.onTreeUpdated((payload) => {
    windowCounts.value = payload.counts
    if (payload.chatId === activeId.value) {
      tree.value = payload.tree
      const winIds = new Set(payload.tree.flatMap((s) => s.windows.map((w) => w.windowId)))
      const sessIds = new Set(payload.tree.map((s) => s.sessionId))
      contextRefs.value = contextRefs.value.filter((r) => {
        if (r.kind === 'session') return sessIds.has(r.sessionId)
        return !!r.windowId && winIds.has(r.windowId)
      })
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
    if (ev.chatId === activeId.value && window.navora) {
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
      const remoteAt = fresh.draftUpdatedAt || 0
      const remoteDraft = fresh.draft || ''
      // Last-write-wins vs local typing.
      if (remoteAt > draftTouchedAt.value) {
        applyDraftLocally(remoteDraft, remoteAt)
      }
    }
  })
  unsubAgent = window.navora.agent.onEvent(async (ev) => {
    if (ev.type === 'status') {
      setRunning(ev.chatId, ev.running)
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
            expandedTools.value = { ...expandedTools.value, [ev.message.id]: true }
            expandRunContaining(ev.message.id)
          }
          void hydrateToolMedia(ev.message, ev.chatId)
        }
      }
      if (ev.message.role === 'log' && isErrorRunLog(ev.message)) {
        if (isActive) expandRunContaining(ev.message.id)
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
        expandedTools.value = { ...expandedTools.value, [ev.message.id]: true }
        expandRunContaining(ev.message.id)
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
        stickToBottom.value = true
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
    permReq.value = req
    trackPermExpiry(req)
    permDialog.value = true
    if (req.chatId === activeId.value) {
      phase.value = 'awaiting_permission'
      phaseDetail.value = `等待授权：${req.capability}`
    }
  })
  unsubPermCancel = window.navora.permission.onCancel((id) => {
    if (permReq.value?.id === id) {
      permDialog.value = false
      permReq.value = null
      clearPermExpiry()
    }
  })
  unsubAsk = window.navora.agent.onAsk((req) => {
    rememberPendingAsk(req)
    phaseByChat.value = {
      ...phaseByChat.value,
      [req.chatId]: { phase: 'awaiting_user', detail: req.question.slice(0, 80) },
    }
    // Auto-open when this chat is active, or when viewing the parent of a sub-chat ask.
    if (req.chatId === activeId.value || req.parentChatId === activeId.value) {
      openAskDialog(req)
    }
  })
  unsubAskCancel = window.navora.agent.onAskCancel((payload) => {
    const id = typeof payload === 'string' ? payload : payload.id
    const reason = typeof payload === 'string' ? undefined : payload.reason
    clearPendingAskById(id)
    closeAskUi(id)
    if (reason === 'timeout') {
      showToast('询问已超时，Agent 将按超时继续', 'warning')
    }
  })
  tickTimer = setInterval(() => {
    if (
      agentRunning.value ||
      askDialog.value ||
      showInlinePendingAsk.value ||
      permDialog.value
    ) {
      nowTick.value = Date.now()
    }
  }, 500)

  const layoutTick = () => {
    onMessagesScroll()
    if (stickToBottom.value) void scrollMessages(true)
    remeasureAllLogOverflow()
  }
  onWinResize = () => layoutTick()
  window.addEventListener('resize', onWinResize)
  void nextTick(() => {
    if (msgBox.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => layoutTick())
      resizeObserver.observe(msgBox.value)
    }
  })

  await loadUiPrefs()
  await refreshSettingsPermissions()
  await refreshList()
  if (!chats.value.length) await createChat()
})

onActivated(() => {
  void refreshList()
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
  void flushDraftSave(activeId.value)
  clearTimeout(draftSaveTimer)
  unsubTree?.()
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
  for (const ro of logResizeObservers.values()) ro.disconnect()
  logResizeObservers.clear()
  logMeasureEls.clear()
  revokeAllMediaUrls()
})
</script>

<style scoped>
.shell {
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
.brand {
  width: 100%;
  min-width: 0;
  padding-right: 12px;
  box-sizing: border-box;
}
.brand-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.brand-name {
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  min-width: 0;
  flex: 1;
}
.brand-search-btn {
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
.brand-sub {
  font-size: 0.75rem;
  opacity: 0.7;
  margin-bottom: 12px;
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
  color: #fff !important;
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
  color: #ecf0f1 !important;
  background: rgba(255, 255, 255, 0.1) !important;
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
  color: #ecf0f1 !important;
  background: rgba(255, 255, 255, 0.1) !important;
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
    max-height 0.28s ease;
  overflow: hidden;
}
.res-slide-enter-from,
.res-slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
  max-height: 0;
}
.res-slide-enter-to,
.res-slide-leave-from {
  max-height: min(48vh, 440px);
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
.chat-stat .svg-inline--fa {
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
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.35;
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
  gap: 12px;
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
  width: 100%;
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
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(10, 16, 22, 0.88);
  display: grid;
  place-items: center;
  padding: 28px 20px 48px;
  cursor: zoom-out;
}
.media-lightbox img {
  max-width: min(96vw, 1400px);
  max-height: calc(100vh - 96px);
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
  max-width: 90vw;
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
.run-card {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid #d5dde5;
  border-radius: 10px;
  background: #f5f8fa;
  overflow: hidden;
}
.run-card.live {
  border-color: #9fc0d8;
  background: linear-gradient(90deg, #f0f7fc, #f7fafc 40%, #eef5fa);
  background-size: 200% 100%;
  animation: tool-shimmer 1.6s linear infinite;
}
.run-card.error {
  border-color: #e8b4ae;
  background: #fdf6f5;
}
.run-card.aborted {
  border-color: #d7dde3;
  background: #f4f6f8;
}
.run-card-head {
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
.run-status {
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
.run-card.live .run-status {
  background: #d6e6f2;
  color: #1b4f72;
}
.run-card.error .run-status {
  background: #f5d4cf;
  color: #c0392b;
}
.run-card.aborted .run-status {
  background: #e2e6ea;
  color: #5d6d7e;
}
.run-card-text {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: #1b2834;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-card-chevron {
  color: #8a97a5;
  font-size: 0.7rem;
  flex-shrink: 0;
}
.run-card-body {
  border-top: 1px solid #e2e8ee;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.run-item.log {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.78rem;
  color: #4a5a68;
  line-height: 1.45;
  user-select: text;
  -webkit-user-select: text;
}
.run-item.log .log-kind-chip {
  height: calc(0.78rem * 1.45);
  user-select: none;
  -webkit-user-select: none;
}
.run-item-text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}
.run-item.tool .tool-card {
  width: 100%;
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
.run-item.tool-aborted .tool-card,
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
  grid-template-columns: minmax(0, 1fr) auto;
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
.composer-expand {
  margin-top: 6px;
  margin-right: 2px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #7f8c8d;
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  font-size: 0.78rem;
  flex-shrink: 0;
}
.composer-expand:hover {
  color: #1b4f72;
  background: #eaf3fa;
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
.composer-box:not(.expanded) .composer-input :deep(textarea) {
  max-height: calc(1.45em * 3);
}
.composer-box.expanded .composer-input :deep(textarea) {
  min-height: calc(1.45em * 10);
  max-height: calc(1.45em * 10);
}
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
  margin: 4px 8px 2px;
  font-size: 0.72rem;
  color: #95a5a6;
  line-height: 1.4;
}

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
  max-height: min(68vh, 640px);
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
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}
.chat-search-hint {
  margin: 18px 8px;
  text-align: center;
  font-size: 0.86rem;
  color: #8a97a5;
}
.chat-search-hit {
  width: 100%;
  display: grid;
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
  font-size: 0.78rem;
  color: #5d6d7e;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.chat-search-hit-meta {
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
  padding-inline: 12px;
}
.shell.mobile-layout .msg,
.shell.mobile-layout .msg-empty,
.shell.mobile-layout .thinking-row,
.shell.mobile-layout .followup-block,
.shell.mobile-layout .retry-bar,
.shell.mobile-layout .pending-ask-card {
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
.shell.mobile-layout .composer-box:not(.expanded) .composer-input :deep(textarea) {
  max-height: calc(1.45em * 2);
}
.shell.mobile-layout .composer-box.expanded .composer-input :deep(textarea) {
  min-height: calc(1.45em * 5);
  max-height: calc(1.45em * 5);
}
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
