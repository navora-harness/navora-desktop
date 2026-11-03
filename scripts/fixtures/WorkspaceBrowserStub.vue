<template><div class="fixture-browser" :data-page-id="tabKey" :data-active="active"><label>网页地址<input aria-label="浏览器地址" :value="url" /></label><p>原生网页边界替身 · {{ tabKey }}</p></div></template>
<script setup lang="ts">defineProps<{chatId:string;tabKey?:string;url?:string;active?:boolean;expanded?:boolean}>()</script>
<style>.fixture-browser{flex:1;background:#fff;padding:20px}.fixture-browser input{margin-left:10px;padding:5px;border:1px solid #dce4ed}.fixture-browser p{margin-top:30px}</style>
