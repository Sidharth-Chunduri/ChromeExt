import { getSummaryFromModel, sendToBlinko } from './api.js';
import { getWebContent } from './jinaReader.js';
import { getSummaryState, updateSummaryState, clearSummaryState, saveSummaryToStorage } from './summaryState.js';

// 处理内容请求
async function handleContentRequest(request) {
    try {
        if (!request || !request.content) {
            throw new Error('无效的请求内容');
        }

        // 更新状态为处理中
        updateSummaryState({
            status: 'processing',
            url: request.url,
            title: request.title
        });

        // 获取存储的设置
        const result = await chrome.storage.sync.get('settings');
        const settings = result.settings;
        
        if (!settings) {
            throw new Error('未找到设置信息');
        }

        let summary;
        if (request.isExtractOnly) {
            // 使用Jina Reader API提取内容
            const response = await getWebContent(request.url, settings);
            if (!response.success) {
                throw new Error(response.error);
            }
            // 移除可能已存在的原文链接
            summary = response.content.replace(/原文链接：\[.*?\]\(.*?\)/g, '').trim();
        } else {
            // 检查必要的设置是否存在
            if (!settings.modelUrl || !settings.apiKey || !settings.modelName) {
                throw new Error('请先完成API设置');
            }
            // 生成总结
            summary = await getSummaryFromModel(request.content, request.url, settings);
        }

        // 如果是直接保存模式
        if (request.directSave) {
            // 直接发送到Blinko
            const response = await sendToBlinko(
                summary,
                request.url,
                request.title,
                null,
                request.isExtractOnly ? 'extract' : 'summary'
            );

            if (response.success) {
                // 显示成功通知
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL('images/icon128.png'),
                    title: chrome.i18n.getMessage(request.isExtractOnly ? "notificationExtractSuccessTitle" : "notificationSummarySuccessTitle"),
                    message: chrome.i18n.getMessage(request.isExtractOnly ? "notificationExtractSuccessMessage" : "notificationSummarySuccessMessage", [request.title || chrome.i18n.getMessage("defaultPage")]),
                    priority: 2
                });
            } else {
                throw new Error(response.error || '保存失败');
            }
        } else {
            // 原有的保存到storage和发送到popup的逻辑
            // 更新状态为完成
            updateSummaryState({
                status: 'completed',
                summary: summary,
                url: request.url,
                title: request.title,
                isExtractOnly: request.isExtractOnly
            });

            // 保存到storage
            await saveSummaryToStorage(summary, request.url, request.title);

            // 同时保存到临时存储，以便popup可以访问
            await chrome.storage.local.set({
                currentSummary: {
                    summary: summary,
                    url: request.url,
                    title: request.title,
                    timestamp: Date.now(),
                    isExtractOnly: request.isExtractOnly
                }
            });

            // 发送总结结果回popup
            try {
                await chrome.runtime.sendMessage({
                    action: 'handleSummaryResponse',
                    success: true,
                    summary: summary,
                    url: request.url,
                    title: request.title,
                    isExtractOnly: request.isExtractOnly
                }).catch(() => {
                    // 忽略错误，popup可能已关闭
                    // 如果popup已关闭，显示系统通知
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: chrome.runtime.getURL('images/icon128.png'),
                        title: chrome.i18n.getMessage(request.isExtractOnly ? "notificationExtractSuccessTitle" : "notificationSummarySuccessTitle"),
                        message: chrome.i18n.getMessage(request.isExtractOnly ? "notificationExtractSuccessMessagePopup" : "notificationSummarySuccessMessagePopup", [request.title || chrome.i18n.getMessage("defaultPage")]),
                        priority: 2
                    });
                });
            } catch (error) {
                console.log('Popup可能已关闭，发送消息失败');
                // 显示系统通知
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL('images/icon128.png'),
                    title: chrome.i18n.getMessage(request.isExtractOnly ? "notificationExtractSuccessTitle" : "notificationSummarySuccessTitle"),
                    message: chrome.i18n.getMessage(request.isExtractOnly ? "notificationExtractSuccessMessagePopup" : "notificationSummarySuccessMessagePopup", [request.title || chrome.i18n.getMessage("defaultPage")]),
                    priority: 2
                });
            }
        }

    } catch (error) {
        console.error('处理内容请求时出错:', error);
        
        // 更新状态为错误
        updateSummaryState({
            status: 'error',
            error: error.message,
            url: request.url,
            title: request.title
        });

        // 尝试发送错误消息到popup
        try {
            await chrome.runtime.sendMessage({
                action: 'handleSummaryResponse',
                success: false,
                error: error.message,
                isExtractOnly: request.isExtractOnly
            }).catch(() => {
                // 忽略错误，popup可能已关闭
            });
        } catch (error) {
            console.log('Popup可能已关闭，发送错误消息失败');
        }

        // 总是显示错误通知
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('images/icon128.png'),
            title: chrome.i18n.getMessage(request.isExtractOnly ? "notificationExtractErrorTitle" : "notificationSummaryErrorTitle"),
            message: chrome.i18n.getMessage("notificationErrorMessage", [
                request.isExtractOnly ? chrome.i18n.getMessage("extractAction") : chrome.i18n.getMessage("summaryAction"),
                request.title || chrome.i18n.getMessage("defaultPage"),
                error.message
            ])
        });
    }
}

// 处理保存总结
async function handleSaveSummary(request) {
    try {
        if (!request || !request.content) {
            throw new Error('无效的请求内容');
        }

        // 获取存储的设置
        const result = await chrome.storage.sync.get('settings');
        const settings = result.settings;
        
        if (!settings) {
            throw new Error('未找到设置信息');
        }

        let finalContent;
        let url = request.url;
        let title = request.title;
        
        // 如果是快捷记录
        if (request.type === 'quickNote') {
            if (!request.content || !request.content.trim()) {
                throw new Error('请输入笔记内容');
            }
            finalContent = request.content.trim();

            try {
                const response = await sendToBlinko(
                    finalContent,
                    url,
                    title,
                    request.attachments,  // 传递附件列表
                    request.type || 'summary'
                );
                
                if (response.success) {
                    // 如果是总结内容，清除存储
                    if (!request.type || request.type !== 'quickNote') {
                        await chrome.storage.local.remove('currentSummary');
                        await clearSummaryState();
                    }
                    return { success: true };
                } else {
                    throw new Error(`保存失败: ${response.status}`);
                }
            } catch (error) {
                throw new Error(`发送内容失败: ${error.message}`);
            }
        } else {
            // 如果是总结内容或提取内容
            if (!request.content || !request.content.trim()) {
                throw new Error('没有可保存的内容');
            }
            finalContent = request.content.trim();

            // 如果没有提供URL和标题，尝试从currentSummary获取
            if (!url || !title) {
                const currentSummary = await chrome.storage.local.get('currentSummary');
                if (currentSummary.currentSummary) {
                    url = url || currentSummary.currentSummary.url;
                    title = title || currentSummary.currentSummary.title;
                }
            }
        }

        try {
            const response = await sendToBlinko(
                finalContent,
                url,
                title,
                null,
                request.type || 'summary'
            );
            
            if (response.success) {
                // 如果是总结内容，清除存储
                if (!request.type || request.type !== 'quickNote') {
                    await chrome.storage.local.remove('currentSummary');
                    await clearSummaryState();
                }
                return { success: true };
            } else {
                throw new Error(`保存失败: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`发送内容失败: ${error.message}`);
        }
    } catch (error) {
        console.error('保存内容时出错:', error);
        return { 
            success: false, 
            error: error.message 
        };
    }
}

// 处理悬浮球请求
async function handleFloatingBallRequest(request) {
    try {
        if (!request || !request.content) {
            throw new Error('无效的请求内容');
        }

        // 更新状态为处理中
        updateSummaryState({
            status: 'processing',
            url: request.url,
            title: request.title
        });

        // 获取存储的设置
        const result = await chrome.storage.sync.get('settings');
        const settings = result.settings;
        
        if (!settings) {
            throw new Error('未找到设置信息');
        }

        let summary;
        if (request.isExtractOnly) {
            // 使用Jina Reader API提取内容
            const response = await getWebContent(request.url, settings);
            if (!response.success) {
                throw new Error(response.error);
            }
            // 移除可能已存在的原文链接
            summary = response.content.replace(/原文链接：\[.*?\]\(.*?\)/g, '').trim();
        } else {
            // 检查必要的设置是否存在
            if (!settings.modelUrl || !settings.apiKey || !settings.modelName) {
                throw new Error('请先完成API设置');
            }
            // 生成总结
            summary = await getSummaryFromModel(request.content, request.url, settings);
        }

        // 准备最终内容
        let finalContent = summary;

        // 发送到服务器（使用现有的重试机制）
        const response = await sendToBlinko(
            finalContent, 
            request.url, 
            request.title, 
            null, 
            request.isExtractOnly ? 'extract' : 'summary'
        );
        
        if (response.success) {
            // 更新状态为完成
            updateSummaryState({
                status: 'completed',
                summary: summary,
                url: request.url,
                title: request.title
            });

            // 保存到storage
            await saveSummaryToStorage(summary, request.url, request.title);

            // 发送成功响应
            try {
                await chrome.runtime.sendMessage({
                    action: 'floatingBallResponse',
                    response: { 
                        success: true,
                        isExtractOnly: request.isExtractOnly
                    }
                });
            } catch (error) {
                console.log('发送响应失败，content script可能已关闭');
            }

            return { success: true };
        } else {
            throw new Error(`服务器返回状态码: ${response.status}`);
        }
    } catch (error) {
        console.error('处理悬浮球请求时出错:', error);
        
        // 更新状态为错误
        updateSummaryState({
            status: 'error',
            error: error.message,
            url: request.url,
            title: request.title
        });

        // 发送错误响应
        try {
            await chrome.runtime.sendMessage({
                action: 'floatingBallResponse',
                response: { 
                    success: false, 
                    error: error.message,
                    isExtractOnly: request.isExtractOnly
                }
            });
        } catch (error) {
            console.log('发送错误响应失败，content script可能已关闭');
        }

        return { 
            success: false, 
            error: error.message 
        };
    }
}

export {
    handleContentRequest,
    handleSaveSummary,
    handleFloatingBallRequest
}; 